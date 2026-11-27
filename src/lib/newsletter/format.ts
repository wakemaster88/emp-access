/** Zeitpunkt für die Verwaltung, z. B. „27.11.2026, 14:32“ (Berlin). */
export function berlinDateTime(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
