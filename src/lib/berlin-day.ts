/**
 * Hilfen für Kalendertage in Europe/Berlin (Einchecken / Monitor „heute“).
 */

export function berlinYmd(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

/** Liegt der Scan-Zeitpunkt am selben Berlin-Kalendertag wie `reference`? */
export function isSameBerlinDay(scanTime: Date | string, reference: Date = new Date()): boolean {
  return berlinYmd(scanTime) === berlinYmd(reference);
}

/** Start des heutigen Berlin-Kalendertags als UTC-Date (00:00 Europe/Berlin). */
export function berlinDayStart(reference: Date = new Date()): Date {
  const ymd = berlinYmd(reference);
  const cest = new Date(`${ymd}T00:00:00+02:00`);
  if (berlinYmd(cest) === ymd) return cest;
  return new Date(`${ymd}T00:00:00+01:00`);
}
