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
