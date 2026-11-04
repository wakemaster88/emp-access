/**
 * Netzwerk-Pruefung auf dem Hub (nur lesend):
 *   - VLAN-Soll/Ist je Switch-Port per SNMP Q-BRIDGE (siehe vlan-analyze.ts)
 *   - Switch antwortet nicht per SNMP
 *
 * Befunde zaehlen erst nach zwei Durchlaeufen in Folge und gehen als
 * komplette Liste an die Cloud (/api/hub/alerts, Quelle "switch"). Die Cloud
 * merkt sich, was offen ist, und meldet Neues bzw. Behobenes per Push und
 * Telegram. Am Switch wird nichts geaendert.
 *
 * Env: HUB_VLAN_CHECK_INTERVAL (Sekunden, Standard 300, 0 = aus).
 */
import { CONFIG, api, log } from "./config.js";
import { friendlySnmpError, oidSuffix, snmpGet, snmpTargets, snmpWalk } from "./snmp.js";
import { analyzeVlans, Confirmer, parsePortList, type VlanIssue } from "./vlan-analyze.js";
import { recordHubEvent } from "./state.js";
import { improve } from "./improve-log.js";

const OID_SYS_NAME = "1.3.6.1.2.1.1.5.0";
const OID_BASE_PORT_IFINDEX = "1.3.6.1.2.1.17.1.4.1.2";
const OID_IF_DESCR = "1.3.6.1.2.1.2.2.1.2";
const OID_IF_NAME = "1.3.6.1.2.1.31.1.1.1.1";
const OID_IF_OPER = "1.3.6.1.2.1.2.2.1.8";
const OID_PVID = "1.3.6.1.2.1.17.7.1.4.5.1.1";
/** dot1qVlanStaticEgressPorts / UntaggedPorts, Index = VLAN-ID. */
const OID_STATIC_EGRESS = "1.3.6.1.2.1.17.7.1.4.3.1.2";
const OID_STATIC_UNTAGGED = "1.3.6.1.2.1.17.7.1.4.3.1.4";
/** dot1qVlanCurrentEgressPorts / UntaggedPorts, Index = TimeMark.VLAN-ID. */
const OID_CURRENT_EGRESS = "1.3.6.1.2.1.17.7.1.4.2.1.4";
const OID_CURRENT_UNTAGGED = "1.3.6.1.2.1.17.7.1.4.2.1.5";

const CONFIRM_RUNS = 2;
const SOURCE = "switch";

export interface AlertItem {
  key: string;
  title: string;
  detail: string;
  severity: "warn" | "alert";
}

interface HostResult {
  host: string;
  sysName: string | null;
  ok: boolean;
  error: string | null;
  issues: VlanIssue[];
  checkedAt: string;
}

const lastResults = new Map<string, HostResult>();
const confirmer = new Confirmer(CONFIRM_RUNS);
let runs = 0;
let busy = false;
let lastConfirmed: AlertItem[] = [];
let lastReportError: string | null = null;

function bitmapTable(rows: Array<{ oid: string; value: string }>, prefix: string, current: boolean) {
  const out = new Map<number, Set<number>>();
  for (const r of rows) {
    const suffix = oidSuffix(r.oid, prefix);
    // Current-Tabelle: TimeMark.VLAN – die VLAN-ID ist der letzte Teil.
    const vlan = Number(current ? suffix.split(".").pop() : suffix);
    if (!Number.isInteger(vlan) || vlan <= 0) continue;
    const ports = parsePortList(r.value);
    const prev = out.get(vlan);
    out.set(vlan, prev ? new Set([...prev, ...ports]) : ports);
  }
  return out;
}

async function checkHost(host: string): Promise<HostResult> {
  const checkedAt = new Date().toISOString();
  const sysName = await snmpGet(host, OID_SYS_NAME);
  const pvidRows = await snmpWalk(host, OID_PVID);
  if (pvidRows.length === 0) {
    // Ohne Q-BRIDGE (z. B. Router) gibt es nichts zu pruefen.
    return { host, sysName, ok: true, error: null, issues: [], checkedAt };
  }
  const hex = ["-Ox"];
  let egressRows = await snmpWalk(host, OID_STATIC_EGRESS, hex).catch(() => []);
  let untaggedRows = await snmpWalk(host, OID_STATIC_UNTAGGED, hex).catch(() => []);
  let current = false;
  if (egressRows.length === 0) {
    egressRows = await snmpWalk(host, OID_CURRENT_EGRESS, hex).catch(() => []);
    untaggedRows = await snmpWalk(host, OID_CURRENT_UNTAGGED, hex).catch(() => []);
    current = true;
  }
  if (egressRows.length === 0) {
    return { host, sysName, ok: true, error: null, issues: [], checkedAt };
  }
  const egress = bitmapTable(egressRows, current ? OID_CURRENT_EGRESS : OID_STATIC_EGRESS, current);
  const untagged = bitmapTable(untaggedRows, current ? OID_CURRENT_UNTAGGED : OID_STATIC_UNTAGGED, current);

  const ifIndexByPort = new Map<number, string>();
  for (const r of await snmpWalk(host, OID_BASE_PORT_IFINDEX).catch(() => [])) {
    const port = Number(oidSuffix(r.oid, OID_BASE_PORT_IFINDEX));
    if (Number.isInteger(port)) ifIndexByPort.set(port, r.value.trim());
  }
  const byIf = async (oid: string) => {
    const m = new Map<string, string>();
    for (const r of await snmpWalk(host, oid).catch(() => [])) m.set(oidSuffix(r.oid, oid), r.value);
    return m;
  };
  const descr = await byIf(OID_IF_DESCR);
  const names = await byIf(OID_IF_NAME);
  const oper = await byIf(OID_IF_OPER);

  const pvid = new Map<number, number>();
  const up = new Map<number, boolean>();
  const label = new Map<number, string>();
  for (const r of pvidRows) {
    const port = Number(oidSuffix(r.oid, OID_PVID));
    const v = Number(r.value);
    if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(v)) continue;
    const ifIndex = ifIndexByPort.get(port) ?? String(port);
    const d = descr.get(ifIndex) ?? "";
    if (/^(lo|vlan|cpu|null)/i.test(d)) continue;
    pvid.set(port, v);
    const o = oper.get(ifIndex);
    if (o != null) up.set(port, o === "1" || /up/i.test(o));
    const n = names.get(ifIndex);
    label.set(port, n && n !== String(port) ? `Port ${port} (${n})` : `Port ${port}`);
  }

  const issues = analyzeVlans({ pvid, egress, untagged, up, label });
  return { host, sysName, ok: true, error: null, issues, checkedAt };
}

function issueSeverity(i: VlanIssue): "warn" | "alert" {
  // Ein abgeschnittener Port mit Link ist ein echter Ausfall (Kamera tot).
  return (i.kind === "pvid-nomember" || i.kind === "untagged-other") && i.up !== false ? "alert" : "warn";
}

function issueDetail(i: VlanIssue): string {
  const link = i.up == null ? "" : i.up ? " Link ist aktiv." : " Kein Link.";
  const hint =
    i.kind === "pvid-nomember" || i.kind === "untagged-other"
      ? " Ungetaggte Geräte am Port landen im falschen oder keinem VLAN. Bekannter GC108P-Fehler nach einer Insight-Änderung: Port in Insight erneut speichern (gewünschtes VLAN ungetaggt + gleiche PVID) und hier nachprüfen."
      : "";
  const now = `Ist: PVID ${i.pvid}, ungetaggt ${i.untaggedIn.length ? i.untaggedIn.join("/") : "–"}, getaggt ${i.taggedIn.length ? i.taggedIn.join("/") : "–"}.`;
  return `${now}${link}${hint}`;
}

function toAlerts(r: HostResult): AlertItem[] {
  const sw = r.sysName || r.host;
  if (!r.ok) {
    return [
      {
        key: `snmp:${r.host}:down`,
        title: `Switch ${sw} (${r.host}) antwortet nicht per SNMP`,
        detail: `${r.error ?? "keine Antwort"}. Geräte hinter diesem Switch sind evtl. auch weg.`,
        severity: "alert",
      },
    ];
  }
  return r.issues.map((i) => ({
    key: `vlan:${r.host}:${i.port}:${i.kind}`,
    title: `${sw}: ${i.message}`,
    detail: issueDetail(i),
    severity: issueSeverity(i),
  }));
}

export function vlanCheckEnabled(): boolean {
  return snmpTargets().length > 0 && vlanCheckIntervalMs() > 0;
}

export function vlanCheckIntervalMs(): number {
  const raw = process.env.HUB_VLAN_CHECK_INTERVAL;
  if (raw === "0") return 0;
  const n = Number(raw);
  return (Number.isFinite(n) && n >= 60 ? n : 300) * 1000;
}

/** Fuer das lokale Dashboard: bestaetigte Befunde je Switch. */
export function vlanCheckSummary(): {
  runs: number;
  reportError: string | null;
  hosts: Array<{ host: string; sysName: string | null; ok: boolean; checkedAt: string; issues: string[] }>;
  confirmed: AlertItem[];
} {
  return {
    runs,
    reportError: lastReportError,
    hosts: [...lastResults.values()].map((r) => ({
      host: r.host,
      sysName: r.sysName,
      ok: r.ok,
      checkedAt: r.checkedAt,
      issues: r.issues.map((i) => i.message),
    })),
    confirmed: lastConfirmed,
  };
}

export async function runVlanCheck(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const hosts = snmpTargets();
    const all: AlertItem[] = [];
    const silent: string[] = [];
    for (const host of hosts) {
      let r: HostResult;
      try {
        r = await checkHost(host);
      } catch (e) {
        const prev = lastResults.get(host);
        r = {
          host,
          sysName: prev?.sysName ?? null,
          ok: false,
          error: friendlySnmpError(e),
          issues: [],
          checkedAt: new Date().toISOString(),
        };
        // VLAN-Befunde dieses Switches nicht als „behoben“ werten.
        silent.push(`vlan:${host}:`);
      }
      lastResults.set(host, r);
      all.push(...toAlerts(r));
    }
    runs++;
    const confirmedKeys = confirmer.update(
      all.map((a) => a.key),
      silent
    );
    const confirmed = all.filter((a) => confirmedKeys.has(a.key));
    const before = new Set(lastConfirmed.map((a) => a.key));
    for (const a of confirmed) {
      if (before.has(a.key)) continue;
      log(`Netzwerk-Prüfung: ${a.title}`);
      recordHubEvent({ kind: "network", severity: a.severity, where: "Switch-Prüfung", title: a.title, detail: a.detail });
    }
    for (const a of lastConfirmed) {
      if (confirmedKeys.has(a.key) || silent.some((p) => a.key.startsWith(p))) continue;
      log(`Netzwerk-Prüfung behoben: ${a.title}`);
      recordHubEvent({ kind: "network", severity: "info", where: "Switch-Prüfung", title: `behoben: ${a.title}` });
    }
    // Befunde stummer Switches bleiben in der lokalen Liste stehen.
    lastConfirmed = [
      ...confirmed,
      ...lastConfirmed.filter((a) => !confirmedKeys.has(a.key) && silent.some((p) => a.key.startsWith(p))),
    ];
    improve("snmp", confirmed.length ? "vlan_issues" : "vlan_ok", { issues: confirmed.length });

    // Erst ab dem zweiten Lauf melden: Vorher ist nichts bestaetigt, die Cloud
    // wuerde offene Befunde nach jedem Hub-Neustart kurz „beheben“.
    if (runs < CONFIRM_RUNS) return;
    const res = await api("/api/hub/alerts", {
      method: "POST",
      body: JSON.stringify({ hubName: CONFIG.name, source: SOURCE, alerts: confirmed, keepPrefixes: silent }),
    });
    lastReportError = res.ok ? null : `HTTP ${res.status}`;
    if (!res.ok) log(`Netzwerk-Prüfung: Meldung an die Cloud fehlgeschlagen (HTTP ${res.status})`);
  } catch (e) {
    lastReportError = e instanceof Error ? e.message : String(e);
    log(`Netzwerk-Prüfung: ${lastReportError}`);
  } finally {
    busy = false;
  }
}

export function startVlanCheck(): void {
  if (!vlanCheckEnabled()) {
    log("Netzwerk-Prüfung (VLAN/SNMP): aus – HUB_SNMP_TARGETS fehlt oder HUB_VLAN_CHECK_INTERVAL=0");
    return;
  }
  const every = vlanCheckIntervalMs();
  log(`Netzwerk-Prüfung (VLAN/SNMP): alle ${Math.round(every / 1000)} s, ${snmpTargets().length} Switches`);
  // Kurz nach dem Start, damit der SNMP-Sync nicht gleichzeitig laeuft.
  setTimeout(() => void runVlanCheck(), 45_000);
  setInterval(() => void runVlanCheck(), every);
}
