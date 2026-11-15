/** Datums- und Fristtexte der Kunden-App (Europe/Berlin). */
export function fmtDay(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
}

/** Ganze Tage bis zu einem Zeitpunkt, mindestens 0. */
export function daysUntil(d: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000));
}

/** "noch 12 Tage", "noch 1 Tag", "nur noch heute" oder "ohne Ablauf". */
export function validityText(expiresAt: Date | null, now: Date = new Date()): string {
  if (!expiresAt) return "ohne Ablauf";
  const days = daysUntil(expiresAt, now);
  if (days <= 1) return "nur noch heute";
  return `noch ${days} Tage`;
}
