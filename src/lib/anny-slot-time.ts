/**
 * Slot-Uhrzeit (`Ticket.slotStart`/`slotEnd`) fuer Tickets aus ANNY - geteilt
 * von Sync und Webhook, damit beide Wege dieselbe Zeit ans Ticket schreiben.
 *
 * Die Slot-Zeit ist die Anzeige- und Gruppierungsquelle im Monitor und die
 * Zaehlbasis der Slot-Auslastung. Fuer den Zutritt ist sie nur bei
 * TIME_SLOT-Gueltigkeit bindend (siehe `scan-check`), bei DURATION dokumentiert
 * sie den Termin, ohne das Zeitbudget zu beschneiden.
 */

import { fmtTimeBerlin } from "@/lib/anny-availability";
import { berlinYmd } from "@/lib/berlin-day";

/**
 * Buchung ueber mehrere Berliner Kalendertage - typisch fuer die
 * Sammelbuchung einer Kursserie ("Ferienkurs 27.–31.07."), die ANNY neben den
 * einzelnen Kurstagen mitliefert. Solche Buchungen bekommen KEINE Slot-Zeit:
 * sie beschreiben den ganzen Kurszeitraum, nicht einen Termin. Mit Slot-Zeit
 * wuerden sie in der Shop-Slot-Uebersicht an jedem Kurstag zusaetzlich zum
 * echten Tagestermin mitgezaehlt und den Slot faelschlich als voll ausweisen.
 */
export function spansMultipleBerlinDays(start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false;
  return berlinYmd(start) !== berlinYmd(end);
}

/**
 * Slot-Uhrzeit (HH:mm) aus der tatsaechlichen Buchungszeit ableiten.
 * Ganztaegige Buchungen (00:00–23:59 o.ae.) gelten NICHT als Slot und liefern
 * null.
 */
export function slotTimesFromBooking(
  start: Date | null,
  end: Date | null,
): { slotStart: string; slotEnd: string } | null {
  if (!start || !end) return null;
  if (spansMultipleBerlinDays(start, end)) return null;
  const s = fmtTimeBerlin(start.toISOString());
  const e = fmtTimeBerlin(end.toISOString());
  if (!s || !e || s === e) return null;
  if (s === "00:00" && (e === "23:59" || e === "00:00")) return null;
  return { slotStart: s, slotEnd: e };
}

export interface SlotTimeDefaults {
  validityType?: string | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  /**
   * Der Service verwaltet seine Plaetze pro Slot selbst (`Service.slotCapacity`).
   * Dann ist die gebuchte Uhrzeit der Termin - auch wenn die Gueltigkeit als
   * DURATION laeuft, wie bei den Anfaengerkursen (Zeitbudget am Lift, Strandbad
   * als Transit).
   */
  slotManaged?: boolean;
}

/**
 * Ergibt die Slot-Felder fuers Ticket-Update. Reihenfolge:
 *   1. Service-/Abo-Default (feste Kurszeit, z.B. Ferienkurs taeglich 10–12).
 *   2. Die echte Buchungszeit - bei TIME_SLOT-Gueltigkeit und bei
 *      slot-verwalteten Services.
 * Sonst leer, damit ein bereits gesetzter Wert am Ticket stehen bleibt.
 */
export function annyTicketSlotTimes(
  defaults: SlotTimeDefaults,
  start: Date | null,
  end: Date | null,
): { slotStart: string; slotEnd: string } | Record<string, never> {
  if (defaults.slotStart && defaults.slotEnd && !spansMultipleBerlinDays(start, end)) {
    return { slotStart: defaults.slotStart, slotEnd: defaults.slotEnd };
  }
  if (defaults.validityType === "TIME_SLOT" || defaults.slotManaged) {
    return slotTimesFromBooking(start, end) ?? {};
  }
  return {};
}
