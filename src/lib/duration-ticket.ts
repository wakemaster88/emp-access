/**
 * Stunden-/Tageskarten: der Timer laeuft ab dem ersten Scan.
 *
 * Der Shop hat DURATION-Services (1 Stunde, Tageskarte) gelegentlich als
 * TIME_SLOT ohne Uhrzeiten gespeichert. Fuer Scan und Reentry zaehlen sie
 * trotzdem als Dauer-Ticket – sonst blockt das Drehkreuz die naechste Runde
 * mit „kein Ausgang“.
 */

export type DurationTicketFields = {
  validityType?: string | null;
  validityDurationMinutes?: number | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  firstScanAt?: Date | null;
};

export function isDurationTicket(t: DurationTicketFields): boolean {
  if (!t.validityDurationMinutes) return false;
  if (t.validityType === "DURATION") return true;
  // Falsch als Zeitslot gespeichert, aber ohne Fenster – das ist eine Stunde.
  return !t.slotStart && !t.slotEnd;
}

export function durationExpiresAt(t: DurationTicketFields): Date | null {
  if (!t.validityDurationMinutes || !t.firstScanAt) return null;
  return new Date(t.firstScanAt.getTime() + t.validityDurationMinutes * 60_000);
}

export function isDurationStillRunning(t: DurationTicketFields, now: Date): boolean {
  if (!isDurationTicket(t)) return false;
  const expiresAt = durationExpiresAt(t);
  if (!expiresAt) return false;
  return now.getTime() <= expiresAt.getTime();
}
