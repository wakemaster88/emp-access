/**
 * SNMP-Sync für NETGEAR-Switches (v2c). Nutzt `snmpwalk` (net-snmp).
 * Liest Ports, PVID und MAC-Tabelle und schickt sie an die Cloud.
 *
 * Alle snmpget/snmpwalk-Aufrufe des Hubs (Switch-Abfrage, VLAN-Pruefung,
 * Router-ARP) laufen ueber eine gemeinsame Warteschlange (snmp-rules.ts,
 * HostQueue): je Adresse hoechstens eine Abfrage zur Zeit. Nur lesend.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CONFIG, api, log } from "./config.js";
import { improve, improveCount } from "./improve-log.js";
import { noteSwitchPoll } from "./health-trends.js";
import { HostQueue, fdbOutcome, snmpRunSummary, switchLine, type SnmpRunState, type SwitchRunEntry } from "./snmp-rules.js";

const execFileAsync = promisify(execFile);
/** Kennung des regelmaessigen Laufs (index.ts). */
export const AUTO_LABEL = "SNMP-Auto";
/** Eine Abfrage je Switch zur Zeit, gleiche Abfragen teilen sich das Ergebnis. */
const queue = new HostQueue();
/** Letzter Lauf fuer den Vergleich der Log-Zeilen (snmpRunSummary). */
let lastRun: SnmpRunState | null = null;

const OID_SYS_NAME = "1.3.6.1.2.1.1.5.0";
const OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0";
const OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0";
const OID_IF_DESCR = "1.3.6.1.2.1.2.2.1.2";
const OID_IF_OPER = "1.3.6.1.2.1.2.2.1.8";
const OID_IF_LAST_CHANGE = "1.3.6.1.2.1.2.2.1.9";
const OID_IF_IN_ERRORS = "1.3.6.1.2.1.2.2.1.14";
const OID_PVID = "1.3.6.1.2.1.17.7.1.4.5.1.1";
const OID_FDB_PORT = "1.3.6.1.2.1.17.7.1.2.2.1.2";
const OID_FDB_PORT_LEGACY = "1.3.6.1.2.1.17.4.3.1.2";

export interface SwitchPort {
  number: number;
  descr: string;
  up: boolean;
  pvid: number | null;
  /** ifInErrors (Zaehler seit Switch-Start), fuer die Frueherkennung. */
  inErrors?: number | null;
  /** ifLastChange in Timeticks: aendert sich bei jedem Link-Wechsel. */
  lastChange?: number | null;
}

export interface MacEntry {
  mac: string;
  port: number;
  vlan: number | null;
}

export interface SwitchSnapshot {
  host: string;
  sysName: string | null;
  sysDescr?: string | null;
  /** Laufzeit seit dem letzten Neustart in Sekunden. */
  uptimeS?: number | null;
  polledAt?: string;
  ports: SwitchPort[];
  macTable: MacEntry[];
  /**
   * Teilausfall: "fdb" = die MAC-Tabelle kam leer, obwohl sie vorher gefuellt
   * war; `macTable` ist dann die vorige mit dem Stand `macsAt`.
   */
  partial?: string[];
  /** Stand der MAC-Tabelle (Abfragezeit, bei einem Teilausfall die vorige). */
  macsAt?: string | null;
}

export function snmpTargets(): string[] {
  return (process.env.HUB_SNMP_TARGETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function community(): string {
  return process.env.HUB_SNMP_COMMUNITY || "public";
}

/** Letzter Stand je Switch fuer das lokale Dashboard (ohne MAC-Tabellen). */
const lastSnapshots = new Map<string, SwitchSnapshot & { error?: string | null }>();

export function lastSwitchSnapshots(): Array<{
  host: string;
  sysName: string | null;
  sysDescr: string | null;
  uptimeS: number | null;
  polledAt: string | null;
  portsUp: number;
  portsTotal: number;
  macs: number;
  error: string | null;
  /** MAC-Tabelle ist die vorige (Teilausfall), Stand in macsAt. */
  partial: boolean;
  macsAt: string | null;
}> {
  return [...lastSnapshots.values()].map((s) => ({
    host: s.host,
    sysName: s.sysName,
    sysDescr: s.sysDescr ?? null,
    uptimeS: s.uptimeS ?? null,
    polledAt: s.polledAt ?? null,
    portsUp: s.ports.filter((p) => p.up).length,
    portsTotal: s.ports.length,
    macs: s.macTable.length,
    error: s.error ?? null,
    partial: (s.partial ?? []).includes("fdb"),
    macsAt: s.macsAt ?? null,
  }));
}

export function snmpConfigured(): boolean {
  return snmpTargets().length > 0;
}

export function parseWalk(stdout: string): Array<{ oid: string; value: string }> {
  const rows: Array<{ oid: string; value: string }> = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^(\.?[0-9]+(?:\.[0-9]+)*)\s*=\s*(?:[A-Z0-9-]+:\s*)?(.*)$/);
    if (!m) {
      // net-snmp bricht lange Hex-Strings (Port-Bitmaps) auf mehrere Zeilen um.
      const last = rows[rows.length - 1];
      if (last && line.trim()) last.value = `${last.value} ${line.trim()}`.trim();
      continue;
    }
    rows.push({ oid: m[1].replace(/^\./, ""), value: m[2].trim().replace(/^"|"$/g, "") });
  }
  return rows;
}

export async function snmpGet(host: string, oid: string): Promise<string | null> {
  try {
    const { stdout } = await queue.run(host, `get ${oid}`, () =>
      execFileAsync("snmpget", ["-v2c", "-c", community(), "-On", "-Oe", host, oid], { timeout: 12_000 })
    );
    return parseWalk(stdout)[0]?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Walk ueber die Warteschlange: Das Zeitlimit (45 s) gilt ab dem Start des
 * Walks, die Wartezeit davor zaehlt nicht mit.
 */
export async function snmpWalk(
  host: string,
  oid: string,
  extraFlags: string[] = []
): Promise<Array<{ oid: string; value: string }>> {
  const { stdout } = await queue.run(host, `walk ${extraFlags.join(" ")} ${oid}`, () =>
    execFileAsync("snmpwalk", ["-v2c", "-c", community(), "-On", "-Oe", ...extraFlags, host, oid], { timeout: 45_000 })
  );
  return parseWalk(stdout);
}

/**
 * Rohe snmpwalk-Fehler ("Command failed: snmpwalk -v2c -c <community> ...")
 * in eine verstaendliche Meldung uebersetzen. Nebenbei landet so die
 * Community nicht im Dashboard oder Log.
 */
export function friendlySnmpError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ENOENT|command not found|spawn snmp/i.test(msg)) {
    return "snmpwalk fehlt auf dem Hub – brew install net-snmp";
  }
  if (/Timeout|No Response|ETIMEDOUT|killed|SIGTERM/i.test(msg)) {
    return "keine SNMP-Antwort – SNMP am Gerät noch nicht aktiviert, Zugriff auf andere IP beschränkt oder Community (HUB_SNMP_COMMUNITY) falsch";
  }
  if (/Unknown host|getaddrinfo/i.test(msg)) return "Switch-Adresse unbekannt";
  if (/authorizationError|noAccess|Unknown user/i.test(msg)) {
    return "SNMP-Zugriff verweigert – Community (HUB_SNMP_COMMUNITY) prüfen";
  }
  return msg.replace(/-c\s+\S+/g, "-c ***").split("\n")[0].slice(0, 200);
}

export function oidSuffix(oid: string, prefix: string): string {
  const p = prefix.replace(/^\./, "");
  return oid.startsWith(p + ".") ? oid.slice(p.length + 1) : "";
}

function macFromOidDec(suffix: string): string | null {
  const parts = suffix.split(".").map(Number);
  if (parts.length < 6) return null;
  const macParts = parts.slice(-6);
  if (macParts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return macParts.map((n) => n.toString(16).padStart(2, "0")).join(":").toUpperCase();
}

/** Suffix der MAC-Tabelle: `<VLAN>.<6 MAC-Oktette>` (Q-BRIDGE) oder nur die MAC (BRIDGE-MIB). */
export function vlanAndMacFromOid(suffix: string): { vlan: number | null; mac: string | null } {
  const parts = suffix.split(".").map(Number);
  if (parts.length >= 7) {
    return { vlan: parts[0], mac: macFromOidDec(parts.slice(1).join(".")) };
  }
  return { vlan: null, mac: macFromOidDec(suffix) };
}

export async function pollSwitch(host: string): Promise<SwitchSnapshot> {
  const sysName = await snmpGet(host, OID_SYS_NAME);
  const sysDescr = await snmpGet(host, OID_SYS_DESCR);
  // sysUpTime in Hundertstelsekunden, z. B. "Timeticks: (12345) 0:02:03.45" oder "12345".
  const uptimeRaw = await snmpGet(host, OID_SYS_UPTIME);
  const ticks = uptimeRaw ? Number(uptimeRaw.match(/\((\d+)\)/)?.[1] ?? uptimeRaw.match(/^\d+/)?.[0]) : NaN;
  const uptimeS = Number.isFinite(ticks) ? Math.round(ticks / 100) : null;
  const descrs = await snmpWalk(host, OID_IF_DESCR);
  const opers = await snmpWalk(host, OID_IF_OPER).catch(() => []);
  const pvids = await snmpWalk(host, OID_PVID).catch(() => []);
  const lastChanges = await snmpWalk(host, OID_IF_LAST_CHANGE).catch(() => []);
  const inErrors = await snmpWalk(host, OID_IF_IN_ERRORS).catch(() => []);
  const numByIdx = (rows: Array<{ oid: string; value: string }>, prefix: string) => {
    const m = new Map<string, number>();
    for (const row of rows) {
      const n = Number(row.value.match(/\((\d+)\)/)?.[1] ?? row.value.match(/^\d+/)?.[0]);
      if (Number.isFinite(n)) m.set(oidSuffix(row.oid, prefix), n);
    }
    return m;
  };
  const lastChangeByIdx = numByIdx(lastChanges, OID_IF_LAST_CHANGE);
  const inErrorsByIdx = numByIdx(inErrors, OID_IF_IN_ERRORS);

  const operByIdx = new Map<string, boolean>();
  for (const row of opers) {
    const idx = oidSuffix(row.oid, OID_IF_OPER);
    operByIdx.set(idx, row.value === "1" || /up/i.test(row.value));
  }
  const pvidByIdx = new Map<string, number>();
  for (const row of pvids) {
    const idx = oidSuffix(row.oid, OID_PVID);
    const n = Number(row.value);
    if (Number.isInteger(n)) pvidByIdx.set(idx, n);
  }

  const ports: SwitchPort[] = [];
  for (const row of descrs) {
    const idx = oidSuffix(row.oid, OID_IF_DESCR);
    const n = Number(idx);
    if (!Number.isInteger(n) || n <= 0) continue;
    const descr = row.value;
    if (!descr || /^(lo|vlan|cpu|null)/i.test(descr)) continue;
    ports.push({
      number: n,
      descr,
      up: operByIdx.get(idx) ?? false,
      pvid: pvidByIdx.get(idx) ?? pvidByIdx.get(String(n)) ?? null,
      inErrors: inErrorsByIdx.get(idx) ?? null,
      lastChange: lastChangeByIdx.get(idx) ?? null,
    });
  }

  let fdb = await snmpWalk(host, OID_FDB_PORT).catch(() => []);
  let fdbPrefix = OID_FDB_PORT;
  if (fdb.length === 0) {
    fdb = await snmpWalk(host, OID_FDB_PORT_LEGACY).catch(() => []);
    fdbPrefix = OID_FDB_PORT_LEGACY;
  }

  const macTable: MacEntry[] = [];
  for (const row of fdb) {
    const suffix = oidSuffix(row.oid, fdbPrefix);
    const { vlan, mac } = vlanAndMacFromOid(suffix);
    const port = Number(row.value);
    if (!mac || !Number.isInteger(port) || port <= 0) continue;
    macTable.push({ mac, port, vlan });
  }

  return { host, sysName, sysDescr, uptimeS, polledAt: new Date().toISOString(), ports, macTable };
}

export async function runSwitchSync(label = "SNMP-Sync"): Promise<{
  ok: boolean;
  switches: number;
  /** Switches ohne Antwort in diesem Lauf. */
  failed?: number;
  error?: string;
}> {
  const hosts = snmpTargets();
  if (hosts.length === 0) {
    improve("snmp", "skip", { reason: "no_targets" });
    return { ok: false, switches: 0, error: "HUB_SNMP_TARGETS fehlt" };
  }
  try {
    const switches: SwitchSnapshot[] = [];
    /** Ganz ausgefallene Switches: gehen als { host, error } mit an die Cloud. */
    const failed: Array<{ host: string; sysName: string | null; error: string }> = [];
    const run: SwitchRunEntry[] = [];
    let firstError: string | null = null;
    for (const host of hosts) {
      try {
        const raw = await pollSwitch(host);
        const prev = lastSnapshots.get(host);
        // Leere MAC-Tabelle nach einer gefuellten: Teilausfall, die vorige
        // Tabelle bleibt mit ihrem Stand stehen (snmp-rules.ts, fdbOutcome).
        const fdb = fdbOutcome(
          prev ? { macTable: prev.macTable, macsAt: prev.macsAt ?? prev.polledAt ?? null } : null,
          raw.macTable,
          raw.polledAt ?? new Date().toISOString()
        );
        const snap: SwitchSnapshot = {
          ...raw,
          macTable: fdb.macTable,
          macsAt: fdb.macsAt,
          ...(fdb.partial ? { partial: ["fdb"] } : {}),
        };
        lastSnapshots.set(host, { ...snap, error: null });
        noteSwitchPoll(host, snap, null);
        if (fdb.partial) improveCount("snmp", `partial_${host}`);
        switches.push(snap);
        run.push({
          host,
          name: snap.sysName,
          error: null,
          ports: snap.ports.length,
          portsUp: snap.ports.filter((p) => p.up).length,
          macs: snap.macTable.length,
          partial: fdb.partial,
        });
      } catch (e) {
        const error = friendlySnmpError(e);
        const prev = lastSnapshots.get(host);
        lastSnapshots.set(host, {
          ...(prev ?? { host, sysName: null, ports: [], macTable: [] }),
          error,
        });
        noteSwitchPoll(host, prev ?? null, error);
        improveCount("snmp", `fail_${host}`);
        failed.push({ host, sysName: prev?.sysName ?? null, error });
        run.push({ host, name: prev?.sysName ?? null, error, ports: 0, portsUp: 0, macs: 0, partial: false });
        firstError ??= error;
      }
    }
    // Der Lauf alle 15 Minuten schreibt nur Aenderungen und einmal je Stunde
    // eine Sammelzeile (snmpRunSummary); ein Abruf von Hand jede Zeile.
    const summary = snmpRunSummary(lastRun, { at: Date.now(), switches: run });
    lastRun = summary.state;
    const lines = label === AUTO_LABEL ? summary.lines : run.map(switchLine);
    for (const line of lines) log(`${label}: ${line}`);

    if (switches.length === 0) improve("snmp", "fail", { error: "unreachable" });
    // Die Cloud gleicht nur die Switches mit Antwort ab (`switches`); die
    // ausgefallenen stehen getrennt in `failed`, damit auch eine Cloud, die
    // das Feld noch nicht kennt, sie nicht als gesehen fuehrt. Bei einem
    // Teilausfall geht die vorige MAC-Tabelle nicht noch einmal hinaus, nur
    // ihre Groesse und ihr Stand: Die Zuordnungen in der Cloud bleiben ohnehin
    // stehen, und alte Eintraege sollen dort nichts als gerade gesehen markieren.
    const upload = switches.map((s) =>
      s.partial?.includes("fdb")
        ? { ...s, macTable: undefined, macs: s.macTable.length }
        : s
    );
    const body = JSON.stringify({ hubName: CONFIG.name, switches: upload, failed });
    if (switches.length === 0) {
      // Nur der Ausfall geht hinaus; scheitert auch die Meldung, zaehlt der
      // Fehler der Switches.
      await api("/api/hub/switch", { method: "POST", body }).catch(() => null);
      return { ok: false, switches: 0, failed: failed.length, error: firstError ?? "kein Switch erreichbar" };
    }
    const res = await api("/api/hub/switch", { method: "POST", body });
    if (!res.ok) {
      improve("snmp", "fail", { error: `HTTP ${res.status}` });
      return { ok: false, switches: switches.length, failed: failed.length, error: `HTTP ${res.status}` };
    }
    improveCount("snmp", "ok");
    return { ok: true, switches: switches.length, failed: failed.length };
  } catch (e) {
    return { ok: false, switches: 0, error: friendlySnmpError(e) };
  }
}
