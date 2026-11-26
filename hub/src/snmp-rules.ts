/**
 * Regeln der Switch-Abfrage per SNMP (snmp.ts, vlan-check.ts), ohne Switch
 * und ohne Hub-Einstellungen testbar (snmp-rules.test.ts):
 *
 *   - HostQueue: eine gemeinsame Warteschlange fuer alle snmpget/snmpwalk-
 *     Aufrufe. Je Adresse laeuft hoechstens eine Abfrage zur Zeit;
 *     verschiedene Switches laufen nebeneinander. Eine Abfrage, die genau so
 *     schon wartet oder laeuft, haengt sich an diese an, statt den Switch ein
 *     zweites Mal zu fragen.
 *   - Takt der VLAN-Pruefung: fester Versatz zur Switch-Abfrage.
 *   - Teilausfall: Eine leere MAC-Tabelle nach einer gefuellten zaehlt als
 *     Ausfall dieser Tabelle; die vorige bleibt mit ihrem Stand stehen.
 *   - snmpRunSummary: Log-Zeilen eines Laufs nur bei Aenderung, sonst einmal
 *     je Stunde eine Sammelzeile.
 *
 * Alle Abfragen sind lesend; am Switch wird nichts geaendert.
 */

/** Ab dem Hub-Start: Die Switch-Abfrage laeuft bei 0 s, 900 s, 1800 s … */
export const VLAN_CHECK_OFFSET_MS = 150_000;

/**
 * Beginn des n-ten Laufs der VLAN-Pruefung (n ab 0) nach dem Hub-Start:
 * Start plus 150 s, dann alle `everyMs`. Mit den Standardtakten (300 s,
 * Switch-Abfrage 900 s) liegen beide immer mindestens 150 s auseinander.
 */
export function vlanCheckRunAtMs(n: number, everyMs: number): number {
  return VLAN_CHECK_OFFSET_MS + n * everyMs;
}

/**
 * Warteschlange je Adresse: `run(host, key, fn)` startet `fn` erst, wenn fuer
 * `host` nichts anderes mehr laeuft. Wartet oder laeuft fuer `host` schon ein
 * Aufruf mit demselben `key` (gleiche Abfrage), bekommt der neue Aufrufer
 * dessen Ergebnis. Ein Fehler trifft nur die eigenen Aufrufer; die
 * Warteschlange laeuft weiter.
 */
export class HostQueue {
  private tails = new Map<string, Promise<void>>();
  private shared = new Map<string, Promise<unknown>>();

  run<T>(host: string, key: string, fn: () => Promise<T>): Promise<T> {
    const id = `${host}\u0000${key}`;
    const same = this.shared.get(id);
    if (same) return same as Promise<T>;
    const tail = this.tails.get(host) ?? Promise.resolve();
    const result = tail.then(() => {
      // Ab hier laeuft die Abfrage: Wer jetzt dieselbe stellt, wartet auf
      // eine neue (die laufende koennte schon fast fertig sein).
      if (this.shared.get(id) === result) this.shared.delete(id);
      return fn();
    });
    this.shared.set(id, result);
    const done = result.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(host, done);
    void done.then(() => {
      if (this.tails.get(host) === done) this.tails.delete(host);
    });
    return result;
  }

  /** Fuer Tests: wartende oder laufende Abfragen je Adresse? */
  busy(host: string): boolean {
    return this.tails.has(host);
  }
}

export interface MacRow {
  mac: string;
  port: number;
  vlan: number | null;
}

/**
 * MAC-Tabelle nach einer Abfrage. Leer, obwohl die vorige Eintraege hatte:
 * Teilausfall (`partial`), die vorige Tabelle bleibt mit ihrem Stand
 * `macsAt` stehen. Sonst gilt die neue Tabelle mit dem Zeitpunkt der Abfrage.
 * Ein Switch mit Link an einem Port kennt immer mindestens eine MAC (die des
 * Gegenuebers); eine leere Tabelle nach einer gefuellten ist deshalb ein
 * gescheiterter Walk, kein leerer Switch.
 */
export function fdbOutcome(
  prev: { macTable: MacRow[]; macsAt: string | null } | null,
  fresh: MacRow[],
  polledAt: string
): { macTable: MacRow[]; macsAt: string | null; partial: boolean } {
  if (fresh.length === 0 && prev && prev.macTable.length > 0) {
    return { macTable: prev.macTable, macsAt: prev.macsAt, partial: true };
  }
  return { macTable: fresh, macsAt: polledAt, partial: false };
}

/** Ein Switch in einem Lauf, wie snmpRunSummary ihn vergleicht. */
export interface SwitchRunEntry {
  host: string;
  name: string | null;
  /** null = Abfrage gelungen. */
  error: string | null;
  ports: number;
  portsUp: number;
  macs: number;
  /** Die MAC-Tabelle ist die vorige (fdbOutcome). */
  partial: boolean;
}

export interface SnmpRunState {
  switches: SwitchRunEntry[];
  /** Zeitpunkt der letzten Zeile dieses Laufs (Aenderung oder Sammelzeile). */
  lastLineAt: number;
}

/** Sammelzeile, wenn eine Stunde lang nichts geaendert wurde. */
export const SNMP_SUMMARY_EVERY_MS = 3_600_000;

function label(s: SwitchRunEntry): string {
  return s.name ? `${s.host} ${s.name}` : s.host;
}

function counts(s: SwitchRunEntry): string {
  const macs = s.partial ? `MAC-Tabelle leer, die vorige (${s.macs} MACs) bleibt stehen` : `${s.macs} MACs`;
  return `${s.ports} Ports, ${s.portsUp} mit Link, ${macs}`;
}

/** Zeile eines Switches wie beim Start: Ports, Ports mit Link, MACs (oder der Fehler). */
export function switchLine(s: SwitchRunEntry): string {
  if (s.error) return `${label(s)}: ${s.error}`;
  return `${label(s)} – ${counts(s)}`;
}

/**
 * Log-Zeilen eines regelmaessigen Laufs (ohne Praefix). Nur bei Aenderung je
 * Switch: neu in der Liste (Zeile wie beim Start), weg oder wieder da,
 * anderer Fehlertext, anderer Name oder andere Port-Zahl, andere Zahl der
 * Ports mit Link, Teilausfall der MAC-Tabelle und dessen Ende, MAC-Tabelle
 * leer oder wieder gefuellt. Die Zahl der MACs allein zaehlt nicht: Sie
 * wandert mit jedem Geraet, das sendet oder verstummt. Ohne jede Aenderung
 * kommt hoechstens einmal je Stunde eine Sammelzeile.
 */
export function snmpRunSummary(
  prev: SnmpRunState | null,
  now: { at: number; switches: SwitchRunEntry[] }
): { lines: string[]; state: SnmpRunState } {
  const before = new Map((prev?.switches ?? []).map((s) => [s.host, s]));
  const lines: string[] = [];
  for (const s of now.switches) {
    const p = before.get(s.host);
    if (!p) {
      lines.push(switchLine(s));
      continue;
    }
    if (s.error) {
      if (p.error !== s.error) lines.push(`${label({ ...s, name: s.name ?? p.name })}: ${s.error}`);
      continue;
    }
    if (p.error) {
      lines.push(`${label(s)} wieder erreichbar – ${counts(s)}`);
      continue;
    }
    const parts: string[] = [];
    if (p.name !== s.name) parts.push(`Name ${p.name ?? "–"} → ${s.name ?? "–"}`);
    if (p.ports !== s.ports) parts.push(`Ports ${p.ports} → ${s.ports}`);
    if (p.portsUp !== s.portsUp) parts.push(`Ports mit Link ${p.portsUp} → ${s.portsUp}`);
    if (s.partial && !p.partial) parts.push(`MAC-Tabelle leer, die vorige (${s.macs} MACs) bleibt stehen`);
    else if (!s.partial && p.partial) parts.push(`MAC-Tabelle wieder gelesen (${s.macs} MACs)`);
    else if (!s.partial && (p.macs > 0) !== (s.macs > 0)) parts.push(s.macs > 0 ? `MAC-Tabelle gefüllt (${s.macs} MACs)` : "MAC-Tabelle leer");
    if (parts.length) lines.push(`${label(s)} – ${parts.join(", ")}`);
  }
  let lastLineAt = prev?.lastLineAt ?? 0;
  if (lines.length) {
    lastLineAt = now.at;
  } else if (now.switches.length > 0 && now.at - lastLineAt >= SNMP_SUMMARY_EVERY_MS) {
    lines.push(runTotals(now.switches));
    lastLineAt = now.at;
  }
  return { lines, state: { switches: now.switches, lastLineAt } };
}

/** Sammelzeile: wie viele Switches antworten, Ports mit Link, MACs, Ausfaelle. */
export function runTotals(switches: SwitchRunEntry[]): string {
  const ok = switches.filter((s) => !s.error);
  const up = ok.reduce((n, s) => n + s.portsUp, 0);
  const macs = ok.reduce((n, s) => n + s.macs, 0);
  const failed = switches.filter((s) => s.error).map((s) => s.host);
  const partial = ok.filter((s) => s.partial).map((s) => s.host);
  let text = `${ok.length}/${switches.length} Switches ok, ${up} Ports mit Link, ${macs} MACs`;
  if (failed.length) text += `; ohne Antwort: ${failed.join(", ")}`;
  if (partial.length) text += `; vorige MAC-Tabelle: ${partial.join(", ")}`;
  return text;
}
