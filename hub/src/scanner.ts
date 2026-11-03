/**
 * Aktiver Netzwerk-Scan: erkennt moeglichst viele Geraete im lokalen Netz
 * inklusive Zusatzinformationen und meldet sie an die Cloud (/api/hub/scan).
 *
 * Ablauf pro Lauf:
 *   1. Subnetze bestimmen: eigene Interfaces (auch VLAN-Interfaces auf dem
 *      Trunk-Port), HUB_VLANS und HUB_SCAN_SUBNETS (netmap.ts).
 *   2. Ping-Sweep ueber jedes Subnetz (fuellt die ARP-Tabelle, misst Antwortzeit).
 *   3. MAC je IP: lokale ARP-Tabelle, fuer geroutete VLANs die ARP-Tabelle des
 *      Routers per SNMP (HUB_SNMP_ROUTER).
 *   4. Pro Geraet anreichern: Hostname (Reverse-DNS), Hersteller (MAC-OUI),
 *      offene TCP-Ports, Shelly-Erkennung, abgeleiteter Geraetetyp, VLAN.
 *
 * Alle Anreicherungen sind best-effort und einzeln fehlertolerant.
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import dns from "node:dns/promises";
import { CONFIG, api, log } from "./config.js";
import { STATE, recordHubEvent } from "./state.js";
import {
  ipToInt,
  knownSubnets,
  macTable,
  pingSweep,
  readArp,
  readRouterArp,
  invalidateArpCache,
  subnetForIp,
  type Subnet,
} from "./netmap.js";
import { probeShelly, type ShellyInfo } from "./shelly.js";
let busy = false;
/** Letztes Scan-Ergebnis fuer das lokale Dashboard (nicht nur die Anzahl). */
let lastDevices: ScannedDevice[] = [];
let lastSubnets: SubnetSummary[] = [];

export interface ScannedDevice {
  ip: string;
  /** null = geroutetes VLAN ohne Router-ARP (wird nicht in die Cloud gemeldet). */
  mac: string | null;
  /** Woher die MAC stammt: lokale ARP-Tabelle oder Router (SNMP). */
  macSource: "arp" | "router" | null;
  iface: string | null;
  vlanId: number | null;
  vlanName: string | null;
  subnet: string | null;
  hostname: string | null;
  vendor: string | null;
  openPorts: number[];
  deviceType: string | null;
  responseMs: number | null;
  reachable: boolean;
  /** Gesetzt, wenn das Geraet ein Shelly ist (lokale API, schaltbar). */
  shelly: ShellyInfo | null;
}

export interface SubnetSummary {
  cidr: string;
  vlanId: number | null;
  vlanName: string | null;
  iface: string | null;
  hubIp: string | null;
  /** direkt = Hub hat ein Interface im Netz; geroutet = nur ueber den Router. */
  mode: "direkt" | "geroutet";
  found: number;
  withMac: number;
}

/** Haeufige TCP-Ports zur Geraete-Identifikation. */
const SCAN_PORTS = [
  21, 22, 23, 53, 80, 111, 135, 139, 143, 443, 445, 515, 548, 554, 631,
  993, 1023, 1883, 3000, 3389, 5000, 5001, 5060, 5900, 6379, 7000, 8000, 8080,
  8443, 8883, 9000, 9100, 32400, 62078,
];

const PORT_CONCURRENCY = 16;
const PORT_TIMEOUT_MS = 700;
const DNS_TIMEOUT_MS = 1500;

/** Fuer bestehende Importe (cameras.ts u. a.): ARP lebt jetzt in netmap.ts. */
export { readArp };

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
  // Standort Tuttenbrocksee
  "EC71DB": "Reolink", "1CCAE3": "DoorBird", "B0C554": "D-Link", "000940": "AGFEO",
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

/** Grobe Geraetetyp-Heuristik aus offenen Ports, Hostname, Hersteller und Shelly-Probe. */
function guessDeviceType(
  ports: number[],
  hostname: string | null,
  vendor: string | null,
  shelly: ShellyInfo | null = null
): string | null {
  const p = new Set(ports);
  const h = (hostname ?? "").toLowerCase();
  const v = (vendor ?? "").toLowerCase();

  if (shelly) return `Shelly ${shelly.app ?? shelly.model ?? ""}`.trim();
  if (/doorbird|bird home/.test(v) || /doorbird/.test(h)) return "Türstation";
  if (/reolink/.test(v)) return "Kamera";
  if (p.has(1023) && !p.has(22)) return "Audio-DSP (Soundweb)";
  if (p.has(9100) || p.has(515) || p.has(631) || /print|hp|canon|epson|brother|kyocera/.test(h))
    return "Drucker";
  if (p.has(554) || /cam|ipcam|axis|hikvision|dahua|reolink/.test(h)) return "Kamera";
  if (p.has(32400) || /plex/.test(h)) return "Medienserver";
  if (p.has(62078) || /iphone|ipad/.test(h)) return "iPhone/iPad";
  if (p.has(3389)) return "Windows-PC";
  if (p.has(548) || p.has(445) || /synology|nas|qnap/.test(h) || /synology|qnap/.test(v)) return "NAS/Server";
  if (p.has(22) && (p.has(80) || p.has(443)) && /raspberry|pi/.test(v)) return "Raspberry Pi";
  if (p.has(1883) || p.has(8883) || /hue|nest|sonos|shelly|tasmota|esp/.test(h)) return "IoT-Gerät";
  if (/router|gateway|fritz|unifi|ubiquiti|netgear|switch|wac|wax|gc\d/.test(h) || /ubiquiti|netgear/.test(v))
    return "Netzwerk (Switch/AP/Router)";
  if (p.has(80) || p.has(443) || p.has(8080)) return "Web-Gerät";
  if (p.has(22)) return "Server/PC";
  return null;
}

/** Kompletter aktiver Scan mit Anreicherung (alle bekannten Subnetze/VLANs). */
async function fullScan(): Promise<{ devices: ScannedDevice[]; subnets: SubnetSummary[] }> {
  const subnets = knownSubnets();
  const pings = await pingSweep(subnets);
  // Nach dem Sweep ist die ARP-Tabelle des Routers frisch -> neu lesen.
  await readRouterArp(true);
  invalidateArpCache();
  const table = await macTable();

  // Kandidaten: alle per Ping erreichbaren IPs, lokale ARP-Eintraege und
  // Router-ARP-Eintraege innerhalb der bekannten Subnetze.
  const ips = new Set<string>(pings.keys());
  for (const [ip, s] of table) {
    if (s.source === "arp" || subnetForIp(ip, subnets)) ips.add(ip);
  }
  const devices: ScannedDevice[] = [];

  // Anreicherung parallel, aber begrenzt (Port-Scans sind teuer).
  const list = [...ips];
  let index = 0;
  const ENRICH_CONCURRENCY = 24;
  async function worker() {
    while (index < list.length) {
      const ip = list[index++];
      const sighting = table.get(ip) ?? null;
      const mac = sighting?.mac ?? null;
      const subnet = subnetForIp(ip, subnets);
      // Ohne MAC und ohne Ping-Antwort gibt es nichts Verlaessliches zu melden.
      if (!mac && !pings.has(ip)) continue;

      const [hostname, openPorts] = await Promise.all([lookupHostname(ip), scanPorts(ip)]);
      const shelly = openPorts.includes(80) ? await probeShelly(ip) : null;
      const vendor = mac ? lookupVendor(mac) : null;
      devices.push({
        ip,
        mac,
        macSource: sighting?.source ?? null,
        iface: sighting?.iface ?? subnet?.iface ?? null,
        vlanId: subnet?.vlanId ?? null,
        vlanName: subnet?.vlanName ?? null,
        subnet: subnet?.cidr ?? null,
        hostname: hostname ?? shelly?.name ?? null,
        vendor: vendor ?? (shelly ? "Shelly" : null),
        openPorts,
        deviceType: guessDeviceType(openPorts, hostname, vendor, shelly),
        responseMs: pings.get(ip) ?? null,
        reachable: pings.has(ip) || openPorts.length > 0,
        shelly,
      });
    }
  }
  await Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, worker));

  devices.sort((a, b) => (ipToInt(a.ip) ?? 0) - (ipToInt(b.ip) ?? 0));
  return { devices, subnets: summarize(subnets, devices) };
}

function summarize(subnets: Subnet[], devices: ScannedDevice[]): SubnetSummary[] {
  return subnets.map((s) => {
    const inNet = devices.filter((d) => d.subnet === s.cidr);
    return {
      cidr: s.cidr,
      vlanId: s.vlanId,
      vlanName: s.vlanName,
      iface: s.iface,
      hubIp: s.hubIp,
      mode: s.iface ? "direkt" : "geroutet",
      found: inNet.length,
      withMac: inNet.filter((d) => d.mac).length,
    };
  });
}

export type CloudScanResult = {
  ok: boolean;
  devices: number;
  processed: number;
  error?: string;
};

/**
 * Vollscan + Cloud-Upload. Wartet ggf. auf einen laufenden Scan
 * (z. B. wenn der Intervall-Scan gerade aktiv ist).
 */
export async function runCloudScan(label = "Auto-Scan"): Promise<CloudScanResult> {
  const waitUntil = Date.now() + 180_000;
  while (busy && Date.now() < waitUntil) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (busy) {
    return { ok: false, devices: 0, processed: 0, error: "Scan läuft bereits" };
  }

  busy = true;
  const startedAt = Date.now();
  try {
    log(`${label} gestartet (Ping-Sweep + Portscan) …`);
    const { devices, subnets } = await fullScan();
    lastDevices = devices;
    lastSubnets = subnets;
    const coverage = subnets
      .map((n) => `${n.vlanName ?? n.cidr}: ${n.found}${n.mode === "geroutet" ? " (geroutet)" : ""}`)
      .join(", ");
    recordHubEvent({
      kind: "network",
      severity: "info",
      where: "LAN",
      title: `${label}: ${devices.length} Geräte`,
      detail: `${Math.round((Date.now() - startedAt) / 1000)} s · ${coverage}`,
    });

    // Die Cloud identifiziert Geraete per MAC – Eintraege ohne MAC bleiben lokal.
    const res = await api("/api/hub/scan", {
      method: "POST",
      body: JSON.stringify({ hubName: CONFIG.name, devices: devices.filter((d) => d.mac) }),
    });
    if (!res.ok) {
      const error = `HTTP ${res.status}`;
      log(`${label}-Upload fehlgeschlagen: ${error}`);
      STATE.autoScan = {
        lastRunAt: new Date().toISOString(),
        devices: devices.length,
        uploaded: false,
        error,
      };
      return { ok: false, devices: devices.length, processed: 0, error };
    }
    const data = (await res.json()) as { processed?: number };
    const processed = data.processed ?? 0;
    const secs = Math.round((Date.now() - startedAt) / 1000);
    log(`${label}: ${devices.length} Geräte in ${secs}s, ${processed} in der Cloud aktualisiert.`);
    STATE.autoScan = {
      lastRunAt: new Date().toISOString(),
      devices: devices.length,
      uploaded: true,
      error: null,
    };
    return { ok: true, devices: devices.length, processed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`${label}-Fehler: ${msg}`);
    STATE.autoScan = { lastRunAt: new Date().toISOString(), devices: 0, uploaded: false, error: msg };
    return { ok: false, devices: 0, processed: 0, error: msg };
  } finally {
    busy = false;
  }
}

/** Letzter Scan fuer das lokale Dashboard (Geraeteliste, nicht nur Zaehler). */
export function lastScanResult(): {
  scanning: boolean;
  lastRunAt: string | null;
  uploaded: boolean;
  error: string | null;
  devices: ScannedDevice[];
  subnets: SubnetSummary[];
} {
  return {
    scanning: busy,
    lastRunAt: STATE.autoScan.lastRunAt,
    uploaded: STATE.autoScan.uploaded,
    error: STATE.autoScan.error,
    devices: lastDevices,
    subnets: lastSubnets.length ? lastSubnets : summarize(knownSubnets(), []),
  };
}

export async function autoScan(): Promise<void> {
  if (busy) return;
  await runCloudScan("Auto-Scan");
}
