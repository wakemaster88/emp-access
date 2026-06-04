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

const SLOT_TZ = "Europe/Berlin";

/** ISO-Zeitstempel -> "HH:mm" in Berliner Wanduhrzeit (oder null). */
function berlinHm(iso: string): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("de-DE", { timeZone: SLOT_TZ, hour: "2-digit", minute: "2-digit" });
}

/** ISO-Zeitstempel -> "YYYY-MM-DD" in Berliner Zeit (oder null). */
function berlinDay(iso: string): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: SLOT_TZ });
}

/**
 * Slot-Uhrzeit eines Tickets als "HH:mm–HH:mm" (bzw. "HH:mm"), oder null wenn
 * keine feste Slot-Zeit hinterlegt ist.
 *
 * Primaerquelle sind die kanonischen slotStart/slotEnd-Felder (zeitzonensicher).
 * Fallback: ANNY-Buchungen tragen ihre konkrete Slot-Zeit nur in
 * startDate/endDate (slotStart/slotEnd bleiben beim Import leer, weil der
 * verknuepfte Service/das Abo keine Default-Uhrzeit hat). Liegt start/end am
 * selben Berliner Tag und bildet ein echtes Intra-Tages-Fenster (kein Ganztags-
 * oder Mehrtages-Ticket, keine DURATION-Karte), leiten wir das Slot-Label
 * daraus ab - sonst landen solche Buchungen faelschlich unter "Ohne feste
 * Uhrzeit", obwohl sie eine gebuchte Uhrzeit haben.
 */
export function monitorSlotLabel(t: {
  slotStart: string | null;
  slotEnd: string | null;
  startDate?: string | null;
  endDate?: string | null;
  validityType?: string | null;
}): string | null {
  if (t.slotStart && t.slotEnd) return `${t.slotStart}–${t.slotEnd}`;
  if (t.slotStart) return t.slotStart;

  if (t.validityType !== "DURATION" && t.startDate && t.endDate) {
    const start = new Date(t.startDate);
    const end = new Date(t.endDate);
    const durationMs = end.getTime() - start.getTime();
    const sameDay = berlinDay(t.startDate) === berlinDay(t.endDate);
    const isIntradaySlot =
      !isNaN(durationMs)
      && durationMs > 0
      && durationMs <= 8 * 60 * 60 * 1000
      && sameDay;
    if (isIntradaySlot) {
      const s = berlinHm(t.startDate);
      const e = berlinHm(t.endDate);
      if (s && e && !(s === "00:00" && e === "00:00")) return `${s}–${e}`;
    }
  }
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
