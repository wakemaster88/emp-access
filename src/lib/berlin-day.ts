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
