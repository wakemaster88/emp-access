/**
 * Waechter-Logik: aus wiederholten Pruefungen Meldungen machen.
 *
 * Ein Befund wird erst gemeldet, wenn er in `confirm` aufeinanderfolgenden
 * Pruefungen da war (eine Kamera, die einmal nicht antwortet, ist kein
 * Alarm). Entwarnung gibt es nur fuer Befunde, die vorher gemeldet wurden.
 * Reine Logik ohne I/O.
 */

export type FindingSeverity = "warn" | "alert";

export interface Finding {
  key: string;
  severity: FindingSeverity;
  title: string;
  detail?: string;
}

interface Tracked {
  finding: Finding;
  seen: number;
  since: number;
  notified: boolean;
}

export interface WatchState {
  tracked: Map<string, Tracked>;
}

export function newWatchState(): WatchState {
  return { tracked: new Map() };
}

export interface WatchDiff {
  opened: Finding[];
  resolved: Array<Finding & { sinceMs: number }>;
}

export function diffFindings(st: WatchState, current: Finding[], now: number, confirm = 2): WatchDiff {
  const opened: Finding[] = [];
  const resolved: WatchDiff["resolved"] = [];
  const keys = new Set(current.map((f) => f.key));
  for (const f of current) {
    const t = st.tracked.get(f.key) ?? { finding: f, seen: 0, since: now, notified: false };
    t.finding = f;
    t.seen++;
    // Alarme (z. B. Cloud weg) sofort, Warnungen erst nach Bestaetigung.
    const need = f.severity === "alert" ? 1 : confirm;
    if (!t.notified && t.seen >= need) {
      t.notified = true;
      opened.push(f);
    }
    st.tracked.set(f.key, t);
  }
  for (const [key, t] of st.tracked) {
    if (keys.has(key)) continue;
    st.tracked.delete(key);
    if (t.notified) resolved.push({ ...t.finding, sinceMs: now - t.since });
  }
  return { opened, resolved };
}

/** Offene, bereits gemeldete Befunde (fuer Tagesbericht und /status). */
export function openFindings(st: WatchState): Finding[] {
  return [...st.tracked.values()].filter((t) => t.notified).map((t) => t.finding);
}
