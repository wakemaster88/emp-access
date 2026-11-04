/**
 * Soll/Ist-Pruefung der VLAN-Konfiguration eines Switches aus den Q-BRIDGE-
 * Tabellen (reine Logik, ohne SNMP – testbar).
 *
 * Hintergrund: Die GC108P setzen eine Port-Aenderung aus Insight manchmal nur
 * halb um. Ergebnis z. B. „PVID 30, aber Port nicht in VLAN 30“: Die Kamera
 * am Port ist abgeschnitten, Insight zeigt aber alles richtig an. Die
 * Wahrheit steht nur im Switch (dot1qPvid + VlanStatic Egress/Untagged).
 *
 * Regeln je Port (Port = dot1dBasePort):
 *   pvid-nomember   PVID v, Port ist kein Mitglied von VLAN v
 *   pvid-tagged     PVID v, Port ist in VLAN v nur getaggt
 *   untagged-other  Port ist ungetaggt in VLAN u ≠ PVID
 *   multi-untagged  Port ist in mehreren VLANs ungetaggt
 */

export interface VlanTables {
  /** basePort → PVID */
  pvid: Map<number, number>;
  /** VLAN → Ports mit Mitgliedschaft (getaggt oder ungetaggt) */
  egress: Map<number, Set<number>>;
  /** VLAN → Ports, die ungetaggt senden */
  untagged: Map<number, Set<number>>;
  /** basePort → Link aktiv (optional) */
  up?: Map<number, boolean>;
  /** basePort → Anzeigename, z. B. "g7" (optional) */
  label?: Map<number, string>;
}

export type VlanIssueKind = "pvid-nomember" | "pvid-tagged" | "untagged-other" | "multi-untagged";

export interface VlanIssue {
  port: number;
  kind: VlanIssueKind;
  pvid: number;
  /** Ungetaggte VLANs des Ports (aufsteigend). */
  untaggedIn: number[];
  /** Getaggte VLANs des Ports (aufsteigend). */
  taggedIn: number[];
  up: boolean | null;
  message: string;
}

/**
 * Port-Bitmap (PortList, RFC 2674) aus snmpwalk-Ausgabe lesen: Erstes Oktett,
 * hoechstes Bit = Port 1. Akzeptiert "Hex-STRING: 80 00", "80 00 ..." und
 * "8000".
 */
export function parsePortList(raw: string): Set<number> {
  const ports = new Set<number>();
  const hex = raw.replace(/^[^:]*STRING:\s*/i, "").replace(/"/g, "");
  const bytes = hex.match(/[0-9a-f]{2}/gi) ?? [];
  bytes.forEach((b, i) => {
    const n = parseInt(b, 16);
    for (let bit = 0; bit < 8; bit++) {
      if (n & (0x80 >> bit)) ports.add(i * 8 + bit + 1);
    }
  });
  return ports;
}

function sorted(xs: Iterable<number>): number[] {
  return [...xs].sort((a, b) => a - b);
}

export function analyzeVlans(t: VlanTables): VlanIssue[] {
  const issues: VlanIssue[] = [];
  const vlansOf = (port: number, table: Map<number, Set<number>>) =>
    sorted([...table.entries()].filter(([, ports]) => ports.has(port)).map(([v]) => v));

  for (const port of sorted(t.pvid.keys())) {
    const pvid = t.pvid.get(port)!;
    const member = vlansOf(port, t.egress);
    const untaggedIn = vlansOf(port, t.untagged);
    // Ungetaggt zaehlt immer auch als Mitglied (manche Switches melden es nur dort).
    const memberSet = new Set([...member, ...untaggedIn]);
    const taggedIn = sorted([...memberSet].filter((v) => !untaggedIn.includes(v)));
    const up = t.up?.get(port) ?? null;
    const name = t.label?.get(port) ?? `Port ${port}`;
    const base = { port, pvid, untaggedIn, taggedIn, up };
    const has = (v: number) => memberSet.has(v);
    const uList = untaggedIn.map((v) => `U${v}`).join(", ");

    if (!has(pvid)) {
      issues.push({
        ...base,
        kind: "pvid-nomember",
        message: `${name}: PVID ${pvid}, aber nicht Mitglied in VLAN ${pvid}${uList ? ` (ist ${uList})` : ""}`,
      });
    } else if (!untaggedIn.includes(pvid)) {
      issues.push({
        ...base,
        kind: "pvid-tagged",
        message: `${name}: PVID ${pvid}, aber VLAN ${pvid} nur getaggt (T${pvid} statt U${pvid})`,
      });
    }
    const other = untaggedIn.filter((v) => v !== pvid);
    if (untaggedIn.length > 1) {
      issues.push({
        ...base,
        kind: "multi-untagged",
        message: `${name}: in mehreren VLANs ungetaggt (${uList}), PVID ${pvid}`,
      });
    } else if (other.length === 1) {
      issues.push({
        ...base,
        kind: "untagged-other",
        message: `${name}: ungetaggt in VLAN ${other[0]}, aber PVID ${pvid}`,
      });
    }
  }
  return issues;
}

/**
 * Bestaetigung ueber mehrere Durchlaeufe: Ein Befund zaehlt erst, wenn er
 * `need`-mal hintereinander auftaucht (eine Insight-Aenderung kann den Port
 * fuer Sekunden halb konfiguriert zeigen).
 */
export class Confirmer {
  private streak = new Map<string, number>();
  constructor(private readonly need: number) {}

  /** Aktuelle Schluessel melden, bestaetigte zurueckbekommen. */
  update(keys: Iterable<string>, keepPrefixes: string[] = []): Set<string> {
    const seen = new Set(keys);
    for (const k of [...this.streak.keys()]) {
      if (seen.has(k)) continue;
      // Nicht abgefragt (Switch stumm): Zaehler einfrieren statt verwerfen.
      if (keepPrefixes.some((p) => k.startsWith(p))) continue;
      this.streak.delete(k);
    }
    for (const k of seen) this.streak.set(k, (this.streak.get(k) ?? 0) + 1);
    return new Set([...seen].filter((k) => (this.streak.get(k) ?? 0) >= this.need));
  }
}
