/** Ortszeit-Stunde und Ruhezeit fuer Warnungen des Waechters (nur Logik, ohne Abhaengigkeiten). */

/** Erst beim ersten Aufruf angelegt: Das Laden des Moduls kann so nie scheitern. */
let hourFormat: Intl.DateTimeFormat | null = null;

/**
 * Stunde aus den Teilen einer formatierten Uhrzeit lesen. Gelesen wird nur
 * der Teil „hour“, nie der ganze Text: Je nach Sprache haengt die
 * Formatierung ein Wort an die Zahl („16 Uhr“), und daraus wird keine Zahl.
 * Das Ergebnis ist eine ganze Zahl von 0 bis 23; alles andere ist ein Fehler
 * und wird geworfen, statt als „keine Zahl“ still durch alle Vergleiche zu
 * fallen.
 */
export function hourFromParts(parts: ReadonlyArray<{ type: string; value: string }>): number {
  const raw = parts.find((p) => p.type === "hour")?.value;
  const hour = raw !== undefined && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(hour) || hour > 23) {
    throw new Error(`Ortszeit: Stunde nicht lesbar (${raw === undefined ? "fehlt" : JSON.stringify(raw)})`);
  }
  return hour;
}

/**
 * Stunde der Ortszeit (Europe/Berlin), 0 bis 23. Nach ihr richten sich das
 * Nachtfenster des Waechters, die Tagsueber-Regel fuer Mitarbeiter, die
 * Ruhezeit und die Messzeit der Belegung.
 */
export function berlinHour(d = new Date()): number {
  hourFormat ??= new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" });
  return hourFromParts(hourFormat.formatToParts(d));
}

/**
 * "22-7" → Ruhezeit 22:00–06:59. Leer/"0" = keine Ruhezeit. Ist die Stunde
 * keine endliche Zahl, ist die Antwort immer nein: Eine Meldung geht dann
 * lieber sofort hinaus, als auf eine Ruhezeit zu warten, die keiner kennt.
 */
export function inQuietHours(spec: string, hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  const m = spec.trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}
