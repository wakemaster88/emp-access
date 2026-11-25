/**
 * Regeln zum Lebenszeichen des Hub-Prozesses (ohne I/O, testbar). Schreiben
 * und Lesen der Datei: alive-mark.ts.
 */

export const ALIVE_INTERVAL_MS = 30_000;

/**
 * Gespeichertes Lebenszeichen lesen (ohne I/O, testbar): ISO-Zeit im Feld
 * `at`, nicht in der Zukunft (eine Minute Uhrenabweichung erlaubt). Alles
 * andere gilt als „unbekannt“.
 */
export function parseAliveMark(raw: string, now: number): string | null {
  try {
    const at = (JSON.parse(raw) as { at?: unknown } | null)?.at;
    if (typeof at !== "string") return null;
    const t = Date.parse(at);
    if (Number.isNaN(t) || t > now + 60_000) return null;
    return new Date(t).toISOString();
  } catch {
    return null;
  }
}
