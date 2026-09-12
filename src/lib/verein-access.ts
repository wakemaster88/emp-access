import { isDurationPastBerlinDay, isDurationTicket } from "@/lib/duration-ticket";

/**
 * Zutritt ueber einen Verein: Mitglieds-Tickets (`Ticket.vereinId`) tragen
 * selbst keine Bereiche, sondern erben die Bereiche der Zutrittstickets ihres
 * Vereins (`VereinAccessTicket`: Bahnmiete, Mitlaeufer-Termin, Jahresticket),
 * solange diese gelten. Gemeinsame Regel fuer die Drehkreuze
 * (`/api/devices/pi/scan`) und den Scan-Check der Hand-/Monitor-Scanner.
 */

/** Prisma-Select der Zutrittsticket-Felder, die fuer die Vererbung zaehlen. */
export const vereinAccessTicketSelect = {
  id: true,
  status: true,
  startDate: true,
  endDate: true,
  validityType: true,
  slotStart: true,
  slotEnd: true,
  validityDurationMinutes: true,
  firstScanAt: true,
  accessAreaId: true,
  ticketAreas: { select: { accessAreaId: true } },
} as const;

export interface VereinAccessTicket {
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  validityType: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: Date | null;
  accessAreaId: number | null;
  ticketAreas: { accessAreaId: number }[];
}

/** Gilt das Zutrittsticket heute grundsaetzlich (Status, Kalendertage)? */
function isValidOnDay(t: VereinAccessTicket, now: Date): boolean {
  if (t.status !== "VALID" && t.status !== "REDEEMED") return false;
  if (t.startDate) {
    const start = new Date(t.startDate);
    start.setUTCHours(0, 0, 0, 0);
    if (now < start) return false;
  }
  if (t.endDate) {
    const end = new Date(t.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) return false;
  }
  return !isDurationPastBerlinDay(t, now);
}

/** Liegt `now` im Zeitfenster des Zutrittstickets (TIME_SLOT, laufende DURATION)? */
function isWithinWindow(t: VereinAccessTicket, now: Date): boolean {
  if ((t.validityType ?? "DATE_RANGE") === "TIME_SLOT" && t.slotStart && t.slotEnd) {
    const berlinNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const minutes = berlinNow.getHours() * 60 + berlinNow.getMinutes();
    const [sh, sm] = t.slotStart.split(":").map(Number);
    const [eh, em] = t.slotEnd.split(":").map(Number);
    if (minutes < sh * 60 + sm || minutes > eh * 60 + em) return false;
  }
  if (isDurationTicket(t) && t.validityDurationMinutes && t.firstScanAt) {
    if (now.getTime() > t.firstScanAt.getTime() + t.validityDurationMinutes * 60_000) return false;
  }
  return true;
}

/**
 * Bereiche, die ein Vereinsmitglied ueber die Zutrittstickets seines Vereins
 * gerade betreten darf.
 *
 * Wie bei normalen Tickets am Drehkreuz gilt das Zeitfenster nur fuer den
 * Hauptbereich (`accessAreaId`) und nur beim Eintritt: Nebenbereiche
 * (`ticketAreas`, z. B. Strandbad und Insel als Weg zur Seilbahn) sind am Tag
 * des Zutrittstickets offen, und wer drin ist, kommt wieder raus. Ohne
 * Hauptbereich gilt das Fenster fuer alle Bereiche des Zutrittstickets.
 */
export function vereinAreaIds(
  accessTickets: VereinAccessTicket[],
  now: Date,
  { isExit = false }: { isExit?: boolean } = {},
): number[] {
  const ids = new Set<number>();
  for (const t of accessTickets) {
    if (!isValidOnDay(t, now)) continue;
    const inWindow = isExit || isWithinWindow(t, now);
    if (t.accessAreaId == null) {
      if (inWindow) for (const ta of t.ticketAreas) ids.add(ta.accessAreaId);
      continue;
    }
    if (inWindow) ids.add(t.accessAreaId);
    for (const ta of t.ticketAreas) {
      if (ta.accessAreaId !== t.accessAreaId) ids.add(ta.accessAreaId);
    }
  }
  return [...ids];
}
