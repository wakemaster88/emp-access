import type { ScanRow } from "./emp-access-scans";

/**
 * Ordnet gezählten Durchgängen die Scans zu, die sie decken.
 *
 * Bewusst ein eigenes Modul: Dieselbe Rechnung entscheidet, was die
 * Auswertung im Admin als „Durchgang ohne Scan" anzeigt und was live einen
 * Alarm auslöst. Liefen beide auseinander, würde das Kontrollzentrum piepen,
 * während die Nachschau eine saubere Bilanz zeigt — und niemand wüsste mehr,
 * welcher Zahl er glauben soll.
 */

/**
 * Wie lange nach einem Scan der zugehörige Durchgang erwartet wird.
 * Gemessen liegen zwischen Piepton und Fußpunkt über der Linie zwei bis
 * fünf Sekunden; bei Andrang staut es sich etwas.
 */
export const MAX_LAG_MS = 30_000;

/** Kleiner Vorlauf gegen Uhren-Versatz zwischen Cloud und Sidecar. */
export const MAX_LEAD_MS = 3_000;

export interface CrossingLike {
  ts: number;
}

export interface PairedCrossing<C extends CrossingLike> {
  crossing: C;
  /** Der deckende Scan — `null`, wenn der Durchgang ungedeckt blieb. */
  scan: ScanRow | null;
}

export interface Pairing<C extends CrossingLike> {
  results: PairedCrossing<C>[];
  /** Scans, die einem Durchgang zugeordnet wurden. */
  usedScanIds: Set<number>;
}

/**
 * Greedy in zeitlicher Reihenfolge: Jeder Durchgang bekommt den jüngsten noch
 * freien gültigen Scan davor. Bei einer Schlange gehen die Leute in der
 * Reihenfolge durch, in der sie gescannt haben.
 *
 * Ein Scan nach dem Durchgang kommt nur als Notnagel zum Zug — sonst zöge ein
 * Nachzügler die Zuordnung an sich, obwohl er die Person, die man durchgehen
 * sah, gar nicht sein kann.
 */
export function pairCrossings<C extends CrossingLike>(
  crossings: C[],
  grantedScans: ScanRow[],
): Pairing<C> {
  const granted = [...grantedScans].sort((a, b) => a.ts - b.ts);
  const ordered = [...crossings].sort((a, b) => a.ts - b.ts);
  const usedScanIds = new Set<number>();
  const results: PairedCrossing<C>[] = [];

  for (const crossing of ordered) {
    let match: ScanRow | null = null;
    let best = Infinity;
    for (const s of granted) {
      if (usedScanIds.has(s.id)) continue;
      if (s.ts > crossing.ts + MAX_LEAD_MS) break;
      const lag = crossing.ts - s.ts;
      if (lag > MAX_LAG_MS) continue;
      // Versatz nach hinten wird bestraft, damit er nur als Notnagel greift.
      const score = lag >= 0 ? lag : MAX_LAG_MS + Math.abs(lag);
      if (score < best) {
        best = score;
        match = s;
      }
    }
    if (match) usedScanIds.add(match.id);
    results.push({ crossing, scan: match });
  }

  return { results, usedScanIds };
}
