/**
 * Netz-Karte des Hubs: welche Subnetze/VLANs gibt es, welche erreicht der Hub
 * direkt (eigenes Interface, z. B. macOS-VLAN-Interface auf einem Trunk-Port)
 * und welche nur geroutet – und unter welcher IP steckt gerade welche MAC.
 *
 * Quellen fuer MAC <-> IP:
 *   1. Lokale ARP-Tabelle (nur direkt angeschlossene Subnetze).
 *   2. ARP-Tabelle des Routers per SNMP (HUB_SNMP_ROUTER), damit auch Geraete
 *      in gerouteten VLANs eine MAC bekommen.
 *
 * Damit bleiben Kameras, DoorBird & Co. auffindbar, wenn sie beim VLAN-Umzug
 * eine neue IP bekommen: gesucht wird per MAC, nicht per fester IP.
 */
import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { log } from "./config.js";
import { community, oidSuffix, snmpWalk } from "./snmp.js";

const exec = promisify(execFile);

export interface Subnet {
  /** z. B. "192.168.30.0/24" */
  cidr: string;
  /** Netzadresse als 32-bit-Zahl. */
  base: number;
  prefixLen: number;
  vlanId: number | null;
  vlanName: string | null;
  /** Lokales Interface, wenn der Hub selbst eine Adresse im Subnetz hat. */
  iface: string | null;
  /** Eigene IP des Hubs im Subnetz (falls direkt angeschlossen). */
  hubIp: string | null;
}

export interface MacSighting {
  mac: string;
  iface: string | null;
  source: "arp" | "router";
}

// ── IP-Helfer ────────────────────────────────────────────────────────────────

export function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!/^\d{1,3}$/.test(p) || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function maskFor(prefixLen: number): number {
  return prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
}

export function parseCidr(cidr: string): { base: number; prefixLen: number } | null {
  const m = cidr.trim().match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const ip = ipToInt(m[1]);
  const prefixLen = m[2] ? Number(m[2]) : 24;
  if (ip === null || prefixLen < 8 || prefixLen > 30) return null;
  return { base: (ip & maskFor(prefixLen)) >>> 0, prefixLen };
}

function inSubnet(ip: number, s: { base: number; prefixLen: number }): boolean {
  return ((ip & maskFor(s.prefixLen)) >>> 0) === s.base;
}

/** Groesste Subnetz-Groesse, die gescannt wird (/22 = 1022 Hosts). */
const MIN_SCAN_PREFIX = 22;

/** Alle Host-Adressen eines Subnetzes (ohne Netz-/Broadcast-Adresse). */
export function subnetHosts(s: Subnet): string[] {
  const prefixLen = Math.max(s.prefixLen, MIN_SCAN_PREFIX);
  const size = 2 ** (32 - prefixLen);
  const hosts: string[] = [];
  for (let i = 1; i < size - 1; i++) hosts.push(intToIp((s.base + i) >>> 0));
  return hosts;
}

export function normalizeMac(raw: string): string | null {
  const parts = raw
    .trim()
    .replace(/^[\w-]+:\s+/, "") // SNMP-Typ-Praefix ("Hex-STRING: ")
    .split(/[\s:.-]+/)
    .filter(Boolean);
  if (parts.length === 1 && /^[0-9a-f]{12}$/i.test(parts[0])) {
    return parts[0].match(/../g)!.join(":").toUpperCase();
  }
  if (parts.length !== 6 || parts.some((p) => !/^[0-9a-f]{1,2}$/i.test(p))) return null;
  return parts.map((p) => p.padStart(2, "0")).join(":").toUpperCase();
}

// ── Subnetze / VLANs ─────────────────────────────────────────────────────────

interface VlanDef {
  vlanId: number;
  name: string;
  base: number;
  prefixLen: number;
  cidr: string;
}

/**
 * HUB_VLANS: "1:Management:192.168.1.0/24,30:Kameras:192.168.30.0/24,…"
 * Liefert die Soll-VLANs des Standorts (Namen + Subnetz).
 */
export function configuredVlans(): VlanDef[] {
  const out: VlanDef[] = [];
  for (const item of (process.env.HUB_VLANS || "").split(",")) {
    const [id, name, cidr] = item.split(":").map((s) => s?.trim());
    const vlanId = Number(id);
    if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094 || !cidr) continue;
    const parsed = parseCidr(cidr);
    if (!parsed) continue;
    out.push({
      vlanId,
      name: name || `VLAN ${vlanId}`,
      ...parsed,
      cidr: `${intToIp(parsed.base)}/${parsed.prefixLen}`,
    });
  }
  return out;
}

function excludedVlans(): Set<number> {
  return new Set(
    (process.env.HUB_SCAN_EXCLUDE || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

/**
 * Alle Subnetze, die der Hub kennt: eigene Interfaces (inkl. VLAN-Interfaces),
 * HUB_VLANS und zusaetzliche HUB_SCAN_SUBNETS (CIDR, komma-getrennt).
 * VLANs aus HUB_SCAN_EXCLUDE werden nicht gescannt.
 */
export function knownSubnets(): Subnet[] {
  const vlans = configuredVlans();
  const excluded = excludedVlans();
  const byCidr = new Map<string, Subnet>();

  const vlanFor = (base: number, prefixLen: number) =>
    vlans.find((v) => v.base === base && v.prefixLen === prefixLen) ??
    vlans.find((v) => inSubnet(base, v)) ??
    null;

  const add = (base: number, prefixLen: number, iface: string | null, hubIp: string | null) => {
    const cidr = `${intToIp(base)}/${prefixLen}`;
    const existing = byCidr.get(cidr);
    if (existing) {
      if (iface && !existing.iface) {
        existing.iface = iface;
        existing.hubIp = hubIp;
      }
      return;
    }
    const vlan = vlanFor(base, prefixLen);
    byCidr.set(cidr, {
      cidr,
      base,
      prefixLen,
      vlanId: vlan?.vlanId ?? null,
      vlanName: vlan?.name ?? null,
      iface,
      hubIp,
    });
  };

  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // Link-local (169.254.x) und VPN-Tunnel bringen nur Rauschen.
      if (a.address.startsWith("169.254.") || /^(utun|ppp|ipsec|wg)/.test(iface)) continue;
      const ip = ipToInt(a.address);
      const mask = a.netmask ? ipToInt(a.netmask) : null;
      if (ip === null) continue;
      // Grosse Netze nur rund um die eigene Adresse scannen (max. /22).
      const prefixLen = Math.min(Math.max(mask === null ? 24 : countBits(mask), MIN_SCAN_PREFIX), 30);
      add((ip & maskFor(prefixLen)) >>> 0, prefixLen, iface, a.address);
    }
  }
  for (const v of vlans) add(v.base, v.prefixLen, null, null);
  for (const raw of (process.env.HUB_SCAN_SUBNETS || "").split(",")) {
    const parsed = raw.trim() ? parseCidr(raw) : null;
    if (parsed) add(parsed.base, parsed.prefixLen, null, null);
  }

  return [...byCidr.values()]
    .filter((s) => s.vlanId === null || !excluded.has(s.vlanId))
    .sort((a, b) => a.base - b.base);
}

function countBits(mask: number): number {
  let n = 0;
  for (let m = mask >>> 0; m; m = (m << 1) >>> 0) n++;
  return n;
}

/** Subnetz (und damit VLAN) zu einer IP. */
export function subnetForIp(ip: string, subnets: Subnet[] = knownSubnets()): Subnet | null {
  const n = ipToInt(ip);
  if (n === null) return null;
  return subnets.find((s) => inSubnet(n, s)) ?? null;
}

// ── Ping ─────────────────────────────────────────────────────────────────────

const PING_CONCURRENCY = 64;

/** Einzelnen Host pingen; liefert Erreichbarkeit + Antwortzeit. */
export async function pingHost(ip: string): Promise<{ reachable: boolean; ms: number | null }> {
  const started = Date.now();
  try {
    const { stdout } = await exec("ping", ["-c", "1", "-W", "600", "-t", "1", ip], { timeout: 1800 });
    const m = stdout.match(/time[=<]([\d.]+)\s*ms/i);
    return { reachable: true, ms: m ? Math.round(parseFloat(m[1])) : Date.now() - started };
  } catch {
    return { reachable: false, ms: null };
  }
}

/** Ping-Sweep ueber die angegebenen Subnetze; liefert Map ip -> Antwortzeit. */
export async function pingSweep(subnets: Subnet[]): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  const targets = subnets.flatMap((s) => subnetHosts(s));
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

// ── ARP lokal + Router ───────────────────────────────────────────────────────

/** Lokale ARP-Tabelle lesen -> IP/MAC/Interface. */
export async function readArp(): Promise<Map<string, { mac: string; iface: string | null }>> {
  const map = new Map<string, { mac: string; iface: string | null }>();
  try {
    const { stdout } = await exec("arp", ["-a", "-n"], { timeout: 15000 });
    for (const line of stdout.split("\n")) {
      // macOS: "? (192.168.1.4) at 8c:3b:ad:65:b1:0 on en0 ifscope [ethernet]"
      const m = line.match(/\(([\d.]+)\) at ([0-9a-fA-F:]+)(?: on (\S+))?/);
      if (!m || m[2] === "ff:ff:ff:ff:ff:ff" || /incomplete/i.test(line)) continue;
      const mac = normalizeMac(m[2]);
      if (mac) map.set(m[1], { mac, iface: m[3] ?? null });
    }
  } catch (e) {
    log(`ARP-Lesen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
  return map;
}

/** ipNetToMediaPhysAddress: Index = ifIndex.a.b.c.d, Wert = MAC. */
const OID_ARP_PHYS = "1.3.6.1.2.1.4.22.1.2";
const ROUTER_ARP_TTL_MS = 120_000;
let routerArpCache: { at: number; map: Map<string, string> } | null = null;
let routerArpWarned = false;

export function routerHost(): string | null {
  return (process.env.HUB_SNMP_ROUTER || "").trim() || null;
}

/** ARP-Tabelle des Routers per SNMP (gecacht, 2 min). Leer ohne HUB_SNMP_ROUTER. */
export async function readRouterArp(force = false): Promise<Map<string, string>> {
  const host = routerHost();
  if (!host) return new Map();
  if (!force && routerArpCache && Date.now() - routerArpCache.at < ROUTER_ARP_TTL_MS) {
    return routerArpCache.map;
  }
  const map = new Map<string, string>();
  try {
    const rows = await snmpWalk(host, OID_ARP_PHYS);
    for (const row of rows) {
      const parts = oidSuffix(row.oid, OID_ARP_PHYS).split(".");
      if (parts.length < 5) continue;
      const ip = parts.slice(-4).join(".");
      const mac = normalizeMac(row.value);
      if (mac && mac !== "FF:FF:FF:FF:FF:FF" && mac !== "00:00:00:00:00:00") map.set(ip, mac);
    }
    routerArpWarned = false;
  } catch (e) {
    if (!routerArpWarned) {
      log(
        `Router-ARP per SNMP (${host}, Community ${community() === "public" ? "public" : "gesetzt"}) fehlgeschlagen: ${
          e instanceof Error ? e.message : e
        }`
      );
      routerArpWarned = true;
    }
    return routerArpCache?.map ?? map;
  }
  routerArpCache = { at: Date.now(), map };
  return map;
}

/**
 * Kombinierte Sicht IP -> MAC. Lokale ARP-Eintraege haben Vorrang (aktueller,
 * direkt gesehen); Router-Eintraege fuellen geroutete VLANs auf.
 */
export async function macTable(): Promise<Map<string, MacSighting>> {
  const [local, router] = await Promise.all([readArp(), readRouterArp()]);
  const out = new Map<string, MacSighting>();
  for (const [ip, mac] of router) out.set(ip, { mac, iface: null, source: "router" });
  for (const [ip, e] of local) out.set(ip, { mac: e.mac, iface: e.iface, source: "arp" });
  return out;
}

/** MAC zu einer IP (lokal oder Router), null wenn unbekannt. */
export async function macForIp(ip: string): Promise<string | null> {
  return (await macTable()).get(ip)?.mac ?? null;
}

// ── MAC -> IP suchen ─────────────────────────────────────────────────────────

/** Ein Wiederfinde-Sweep hoechstens alle 2 Minuten (teilen sich alle Geraete). */
const RELOCATE_SWEEP_MS = 120_000;
let lastRelocateSweepAt = 0;
let relocateSweep: Promise<void> | null = null;

async function sweepDirectSubnets(): Promise<void> {
  if (relocateSweep) return relocateSweep;
  if (Date.now() - lastRelocateSweepAt < RELOCATE_SWEEP_MS) return;
  lastRelocateSweepAt = Date.now();
  relocateSweep = (async () => {
    // Direkte Netze fuellen die lokale ARP-Tabelle. Geroutete Netze lohnen nur,
    // wenn der Router per SNMP seine ARP-Tabelle verraet.
    const targets = knownSubnets().filter((s) => s.iface || routerHost());
    if (targets.length === 0) return;
    await pingSweep(targets);
    await readRouterArp(true);
  })().finally(() => {
    relocateSweep = null;
  });
  return relocateSweep;
}

/**
 * Aktuelle IP zu einer MAC finden. Ohne Treffer (optional) einmal alle direkt
 * angeschlossenen Subnetze (mit HUB_SNMP_ROUTER auch die gerouteten) anpingen, damit die ARP-Tabelle gefuellt ist, und
 * erneut suchen. `exclude` = bisherige IP (die gerade nicht antwortet).
 */
export async function findIpByMac(
  mac: string,
  opts: { sweep?: boolean; exclude?: string } = {}
): Promise<string | null> {
  const wanted = normalizeMac(mac);
  if (!wanted) return null;
  const search = async () => {
    for (const [ip, s] of await macTable()) {
      if (s.mac === wanted && ip !== opts.exclude) return ip;
    }
    return null;
  };
  const hit = await search();
  if (hit || !opts.sweep) return hit;
  await sweepDirectSubnets();
  return search();
}
