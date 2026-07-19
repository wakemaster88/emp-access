/**
 * Aktiver Netzwerk-Scan: erkennt moeglichst viele Geraete im lokalen Netz
 * inklusive Zusatzinformationen und meldet sie an die Cloud (/api/hub/scan).
 *
 * Ablauf pro Lauf:
 *   1. Alle lokalen IPv4-Subnetze bestimmen.
 *   2. Ping-Sweep ueber jedes /24 (fuellt die ARP-Tabelle, misst Antwortzeit).
 *   3. ARP-Tabelle lesen -> IP/MAC/Interface.
 *   4. Pro Geraet anreichern: Hostname (Reverse-DNS), Hersteller (MAC-OUI),
 *      offene TCP-Ports, abgeleiteter Geraetetyp.
 *
 * Alle Anreicherungen sind best-effort und einzeln fehlertolerant.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import dns from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { CONFIG, api, log } from "./config.js";
import { STATE } from "./state.js";

const exec = promisify(execFile);
let busy = false;

export interface ScannedDevice {
  ip: string;
  mac: string;
  iface: string | null;
  hostname: string | null;
  vendor: string | null;
  openPorts: number[];
  deviceType: string | null;
  responseMs: number | null;
  reachable: boolean;
}

/** Haeufige TCP-Ports zur Geraete-Identifikation. */
const SCAN_PORTS = [
  21, 22, 23, 53, 80, 111, 135, 139, 143, 443, 445, 515, 548, 554, 631,
  993, 1883, 3000, 3389, 5000, 5001, 5060, 5900, 6379, 7000, 8000, 8080,
  8443, 8883, 9000, 9100, 32400, 62078,
];

const PING_CONCURRENCY = 64;
const PORT_CONCURRENCY = 16;
const PORT_TIMEOUT_MS = 700;
const DNS_TIMEOUT_MS = 1500;

/** Lokale IPv4-Interfaces mit /24-Praefix (auf /24 begrenzt fuer sinnvolle Laufzeit). */
function localSubnets(): { prefix: string; iface: string }[] {
  const nets: { prefix: string; iface: string }[] = [];
  const seen = new Set<string>();
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        const parts = a.address.split(".");
        if (parts.length !== 4) continue;
        const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
        if (seen.has(prefix)) continue;
        seen.add(prefix);
        nets.push({ prefix, iface });
      }
    }
  }
  return nets;
}

/** Einzelnen Host pingen; liefert Erreichbarkeit + Antwortzeit. */
async function pingHost(ip: string): Promise<{ reachable: boolean; ms: number | null }> {
  const started = Date.now();
  try {
    const { stdout } = await exec("ping", ["-c", "1", "-W", "600", "-t", "1", ip], { timeout: 1800 });
    const m = stdout.match(/time[=<]([\d.]+)\s*ms/i);
    return { reachable: true, ms: m ? Math.round(parseFloat(m[1])) : Date.now() - started };
  } catch {
    return { reachable: false, ms: null };
  }
}

/** Ping-Sweep ueber alle Subnetze; liefert Map ip -> Antwortzeit. */
async function pingSweep(): Promise<Map<string, number | null>> {
  const subnets = localSubnets();
  const result = new Map<string, number | null>();
  if (subnets.length === 0) return result;

  const targets: string[] = [];
  for (const { prefix } of subnets) {
    for (let host = 1; host <= 254; host++) targets.push(`${prefix}.${host}`);
  }

  let index = 0;
  async function worker() {
    while (index < targets.length) {
      const ip = targets[index++];
      const { reachable, ms } = await pingHost(ip);
      if (reachable) result.set(ip, ms);
    }
  }
  await Promise.all(Array.from({ length: PING_CONCURRENCY }, worker));
  return result;
}

/** ARP-Tabelle lesen -> IP/MAC/Interface. */
async function readArp(): Promise<Map<string, { mac: string; iface: string | null }>> {
  const map = new Map<string, { mac: string; iface: string | null }>();
  try {
    const { stdout } = await exec("arp", ["-a", "-n"], { timeout: 15000 });
    for (const line of stdout.split("\n")) {
      // macOS: "? (192.168.1.4) at 8c:3b:ad:65:b1:0 on en0 ifscope [ethernet]"
      const m = line.match(/\(([\d.]+)\) at ([0-9a-fA-F:]+)(?: on (\S+))?/);
      if (!m || m[2] === "ff:ff:ff:ff:ff:ff" || /incomplete/i.test(line)) continue;
      const mac = m[2].split(":").map((o) => o.padStart(2, "0")).join(":").toUpperCase();
      map.set(m[1], { mac, iface: m[3] ?? null });
    }
  } catch (e) {
    log(`ARP-Lesen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
  return map;
}

// ── MAC-Hersteller (OUI) ─────────────────────────────────────────────────────

let ouiMap: Map<string, string> | null = null;

const OUI_FILES = [
  "/opt/homebrew/share/nmap/nmap-mac-prefixes",
  "/usr/local/share/nmap/nmap-mac-prefixes",
  "/usr/share/nmap/nmap-mac-prefixes",
];

/** Kleiner Fallback fuer haeufige Hersteller, falls keine nmap-Datei da ist. */
const OUI_FALLBACK: Record<string, string> = {
  "001451": "Apple", "0016CB": "Apple", "0017F2": "Apple", "3C0754": "Apple",
  "F0189E": "Apple", "A4C361": "Apple", "8C3BAD": "Netgear", "000C29": "VMware",
  "B827EB": "Raspberry Pi", "DCA632": "Raspberry Pi", "E45F01": "Raspberry Pi",
  "001788": "Philips Hue", "005043": "Marvell", "F4F5D8": "Google",
  "3C5AB4": "Google", "18B430": "Nest", "000E58": "Sonos", "B8E937": "Sonos",
  "001132": "Synology", "0011D8": "ASUS", "AC220B": "ASUS", "D850E6": "ASUS",
  "E091F5": "Netgear", "A040A0": "Netgear", "FCECDA": "Ubiquiti", "788A20": "Ubiquiti",
  "44D9E7": "Ubiquiti", "245A4C": "Ubiquiti", "00A0DE": "Yamaha",
  "001C42": "Parallels", "0050F2": "Microsoft", "0025AE": "Microsoft",
  "D89E3F": "Apple", "AC87A3": "Apple", "F0DBF8": "Apple", "6C4008": "Apple",
};

function loadOui(): Map<string, string> {
  if (ouiMap) return ouiMap;
  ouiMap = new Map(Object.entries(OUI_FALLBACK));
  for (const file of OUI_FILES) {
    try {
      const text = readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^([0-9A-Fa-f]{6})\s+(.+)$/);
        if (m) ouiMap.set(m[1].toUpperCase(), m[2].trim());
      }
      log(`OUI-Datenbank geladen: ${file} (${ouiMap.size} Eintraege)`);
      break;
    } catch {
      // naechste Datei versuchen
    }
  }
  return ouiMap;
}

function lookupVendor(mac: string): string | null {
  const prefix = mac.replace(/:/g, "").slice(0, 6).toUpperCase();
  return loadOui().get(prefix) ?? null;
}

// ── Reverse-DNS Hostname ─────────────────────────────────────────────────────

async function lookupHostname(ip: string): Promise<string | null> {
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error("timeout")), DNS_TIMEOUT_MS)),
    ]);
    return names[0]?.replace(/\.$/, "") ?? null;
  } catch {
    return null;
  }
}

// ── Port-Scan ────────────────────────────────────────────────────────────────

function checkPort(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(PORT_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, ip);
  });
}

async function scanPorts(ip: string): Promise<number[]> {
  const open: number[] = [];
  let index = 0;
  async function worker() {
    while (index < SCAN_PORTS.length) {
      const port = SCAN_PORTS[index++];
      if (await checkPort(ip, port)) open.push(port);
    }
  }
  await Promise.all(Array.from({ length: PORT_CONCURRENCY }, worker));
  return open.sort((a, b) => a - b);
}

/** Grobe Geraetetyp-Heuristik aus offenen Ports und Hostname. */
function guessDeviceType(ports: number[], hostname: string | null, vendor: string | null): string | null {
  const p = new Set(ports);
  const h = (hostname ?? "").toLowerCase();
  const v = (vendor ?? "").toLowerCase();

  if (p.has(9100) || p.has(515) || p.has(631) || /print|hp|canon|epson|brother|kyocera/.test(h))
    return "Drucker";
  if (p.has(554) || /cam|ipcam|axis|hikvision|dahua|reolink/.test(h)) return "Kamera";
  if (p.has(32400) || /plex/.test(h)) return "Medienserver";
  if (p.has(62078) || /iphone|ipad/.test(h)) return "iPhone/iPad";
  if (p.has(3389)) return "Windows-PC";
  if (p.has(548) || p.has(445) || /synology|nas|qnap/.test(h) || /synology|qnap/.test(v)) return "NAS/Server";
  if (p.has(22) && (p.has(80) || p.has(443)) && /raspberry|pi/.test(v)) return "Raspberry Pi";
  if (p.has(1883) || p.has(8883) || /hue|nest|sonos|shelly|tasmota|esp/.test(h)) return "IoT-Gerät";
  if (/router|gateway|fritz|unifi|ubiquiti|netgear/.test(h) || /ubiquiti|netgear/.test(v)) return "Router/AP";
  if (p.has(80) || p.has(443) || p.has(8080)) return "Web-Gerät";
  if (p.has(22)) return "Server/PC";
  return null;
}

/** Kompletter aktiver Scan mit Anreicherung. */
async function fullScan(): Promise<ScannedDevice[]> {
  const pings = await pingSweep();
  const arp = await readArp();

  // Kandidaten: alles mit MAC (ARP) plus per Ping erreichbare IPs.
  const ips = new Set<string>([...arp.keys(), ...pings.keys()]);
  const devices: ScannedDevice[] = [];

  // Anreicherung parallel, aber begrenzt (Port-Scans sind teuer).
  const list = [...ips];
  let index = 0;
  const ENRICH_CONCURRENCY = 24;
  async function worker() {
    while (index < list.length) {
      const ip = list[index++];
      const arpEntry = arp.get(ip);
      const mac = arpEntry?.mac ?? null;
      // Ohne MAC koennen wir das Geraet nicht stabil identifizieren -> ueberspringen.
      if (!mac) continue;

      const [hostname, openPorts] = await Promise.all([lookupHostname(ip), scanPorts(ip)]);
      const vendor = lookupVendor(mac);
      devices.push({
        ip,
        mac,
        iface: arpEntry?.iface ?? null,
        hostname,
        vendor,
        openPorts,
        deviceType: guessDeviceType(openPorts, hostname, vendor),
        responseMs: pings.get(ip) ?? null,
        reachable: pings.has(ip) || openPorts.length > 0,
      });
    }
  }
  await Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, worker));

  devices.sort((a, b) => {
    const pa = a.ip.split(".").map(Number);
    const pb = b.ip.split(".").map(Number);
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
  return devices;
}

export async function autoScan(): Promise<void> {
  if (busy) return;
  busy = true;
  const startedAt = Date.now();
  try {
    log("Auto-Scan gestartet (Ping-Sweep + Portscan) …");
    const devices = await fullScan();

    const res = await api("/api/hub/scan", {
      method: "POST",
      body: JSON.stringify({ hubName: CONFIG.name, devices }),
    });
    if (!res.ok) {
      log(`Auto-Scan-Upload fehlgeschlagen: HTTP ${res.status}`);
      STATE.autoScan = { lastRunAt: new Date().toISOString(), devices: devices.length, uploaded: false, error: `HTTP ${res.status}` };
      return;
    }
    const data = (await res.json()) as { processed?: number };
    const secs = Math.round((Date.now() - startedAt) / 1000);
    log(`Auto-Scan: ${devices.length} Geräte in ${secs}s, ${data.processed ?? 0} in der Cloud aktualisiert.`);
    STATE.autoScan = { lastRunAt: new Date().toISOString(), devices: devices.length, uploaded: true, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Auto-Scan-Fehler: ${msg}`);
    STATE.autoScan = { lastRunAt: new Date().toISOString(), devices: 0, uploaded: false, error: msg };
  } finally {
    busy = false;
  }
}
