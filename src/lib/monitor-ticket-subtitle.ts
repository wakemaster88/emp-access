/**
 * Zweite Zeile in der Monitor-Liste: Produkt/Service/Typ – nicht den Personennamen wiederholen.
 */

export type MonitorTicketSubtitleInput = {
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  subscriptionId: number | null;
  service?: { name: string } | null;
  subscription?: { name: string } | null;
  accessArea?: { name: string } | null;
  slotStart: string | null;
  slotEnd: string | null;
  validityType: string;
  validityDurationMinutes: number | null;
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Slot-Uhrzeit eines Tickets als "HH:mm–HH:mm" (bzw. "HH:mm"), oder null wenn
 * keine feste Slot-Zeit hinterlegt ist. Quelle sind die kanonischen
 * slotStart/slotEnd-Felder (zeitzonensicher, im Gegensatz zu startDate).
 */
export function monitorSlotLabel(t: { slotStart: string | null; slotEnd: string | null }): string | null {
  if (t.slotStart && t.slotEnd) return `${t.slotStart}–${t.slotEnd}`;
  if (t.slotStart) return t.slotStart;
  return null;
}

/** Sortierschluessel (Minuten ab Mitternacht) aus einem Slot-Label "HH:mm…". */
export function slotLabelStartMinutes(label: string): number {
  const m = label.match(/^(\d{2}):(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function isRedundantLabel(
  label: string | null | undefined,
  displayPerson: string,
  bookingName: string
): boolean {
  if (!label?.trim()) return true;
  const t = norm(label);
  return t === norm(displayPerson) || t === norm(bookingName);
}

/** Kurzbeschreibung des Tickets (ohne Person); null wenn nichts Sinnvolles übrig bleibt. */
export function monitorTicketTypeLine(ticket: MonitorTicketSubtitleInput): string | null {
  const person = [ticket.firstName, ticket.lastName].filter(Boolean).join(" ").trim();
  const displayPerson = (person || ticket.name).trim();
  const bookingName = ticket.name.trim();

  for (const candidate of [ticket.ticketTypeName, ticket.service?.name, ticket.subscription?.name]) {
    if (!isRedundantLabel(candidate, displayPerson, bookingName)) {
      return candidate!.trim();
    }
  }

  if (ticket.slotStart && ticket.slotEnd) {
    return `${ticket.slotStart}–${ticket.slotEnd} Uhr`;
  }
  if (ticket.validityType === "DURATION" && ticket.validityDurationMinutes) {
    return `${ticket.validityDurationMinutes} Min.`;
  }
  if (!isRedundantLabel(ticket.accessArea?.name ?? null, displayPerson, bookingName)) {
    return ticket.accessArea!.name.trim();
  }

  return null;
}
