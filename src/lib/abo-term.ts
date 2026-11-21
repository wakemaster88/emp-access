/**
 * Kurzangaben zur Abo-Laufzeit für die Abo-Karte am Check-in-Monitor.
 *
 * anny liefert den Tarif als „Ride Abo | 12M“. Der Abo-Name steht am Monitor
 * schon als Gruppenkopf, auf der Karte bleibt nur der Tarif („12 Monate“).
 */
export function aboTariffLabel(ticketTypeName: string | null | undefined): string | null {
  const raw = ticketTypeName?.trim();
  if (!raw) return null;
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  const tariff = parts.length > 1 ? parts[parts.length - 1] : raw;
  const months = /^(\d+)\s*M$/i.exec(tariff);
  if (months) {
    const n = Number(months[1]);
    return n === 1 ? "1 Monat" : `${n} Monate`;
  }
  return tariff;
}

/** Ganze Kalendertage (Europe/Berlin) von `now` bis `end`; negativ, wenn vorbei. */
export function daysUntil(end: Date, now: Date = new Date()): number {
  const day = (d: Date) => {
    const s = d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    return Date.parse(`${s}T00:00:00Z`);
  };
  return Math.round((day(end) - day(now)) / 86_400_000);
}

export type AboEndState = { label: string; tone: "muted" | "warning" | "danger" };

/**
 * Ende der Laufzeit als kurzer Text: „bis 06.04.27“, in den letzten 14 Tagen
 * „noch 5 Tage“ (Hinweisfarbe), danach „abgelaufen“.
 */
export function aboEndState(end: Date, now: Date = new Date()): AboEndState {
  const days = daysUntil(end, now);
  if (end.getTime() < now.getTime() && days < 0) return { label: "abgelaufen", tone: "danger" };
  if (days <= 0) return { label: "endet heute", tone: "warning" };
  if (days <= 14) return { label: days === 1 ? "noch 1 Tag" : `noch ${days} Tage`, tone: "warning" };
  const date = end.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/Berlin" });
  return { label: `bis ${date}`, tone: "muted" };
}
