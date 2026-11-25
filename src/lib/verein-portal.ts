import { randomBytes } from "node:crypto";
import { berlinOffset } from "@/lib/anny-availability";
import { berlinDayRange } from "@/lib/berlin-day";
import { loadServiceSlots } from "@/lib/service-slots";
import { sendPushToAccount } from "@/lib/web-push";
import { sendRequestToTelegram } from "@/lib/verein-request-telegram";
import { blockServiceSlot, releaseSlotBlock, resolveAnnyServiceResource } from "@/lib/slot-blocks";
import { fetchAnnyResourceBusy } from "@/lib/anny-slot-usage";
import { daylightDay, daylightSlotStates, overlaps, type DaylightDay, type Interval } from "@/lib/verein-daylight";
import { clipToProfileSpans, relatedResources } from "@/lib/verein-related-bookings";
import { scheduleSpecInclude, toScheduleSpec } from "@/lib/operating-queries";
import { prisma, tenantClient } from "@/lib/prisma";
import { deviceSendsRemoteCommand, isActionAllowedForDevice, triggerDeviceAction } from "@/lib/device-open";
import { recordDeviceAction } from "@/lib/device-action-log";
import {
  accessWindow,
  bookingPrice,
  canVereinCancel,
  clampedBerlinHm,
  isDateBookable,
  portalLimitError,
  portalSlotStates,
  type PortalSlot,
} from "@/lib/verein-portal-rules";

/**
 * Vereinsportal: ein Verein bucht ueber einen geheimen Link
 * (`/verein/<portalToken>`) selbst Slots der freigegebenen Services.
 *
 * Eine Buchung
 *   1. sperrt den Slot in ANNY (SlotBlock, wie die Sperre am Check-in-Monitor),
 *   2. legt ein Zutritts-Ticket (TIME_SLOT) an und haengt es an den Verein,
 *      damit die Mitglieder genau in diesem Slot reinkommen,
 *   3. wird mit Preis-Schnappschuss fuer die spaetere Abrechnung gespeichert.
 */

export function generatePortalToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Verein zum Portal-Link, nur wenn das Portal eingeschaltet ist. */
export async function loadPortalVerein(token: string) {
  if (!token || token.length < 16) return null;
  const verein = await prisma.verein.findUnique({
    where: { portalToken: token },
    select: {
      id: true,
      name: true,
      accountId: true,
      portalEnabled: true,
      portalCancelHours: true,
      portalHorizonDays: true,
      portalLeadMinutes: true,
      portalTrailMinutes: true,
      portalDeviceIds: true,
      portalDoorbirdIds: true,
      portalMaxOpenBookings: true,
      portalMaxInclusivePerMonth: true,
      account: { select: { name: true, latitude: true, longitude: true } },
      bookableServices: {
        select: {
          serviceId: true,
          priceCents: true,
          daylight: true,
          inclusive: true,
          service: { select: { id: true, name: true, defaultValidityDurationMinutes: true } },
        },
        orderBy: { service: { name: "asc" } },
      },
    },
  });
  if (!verein || !verein.portalEnabled) return null;
  return verein;
}

export type PortalVerein = NonNullable<Awaited<ReturnType<typeof loadPortalVerein>>>;

/** Slots eines Tages aus Sicht des Vereins (frei, belegt, eigene Buchung). */
export async function loadPortalSlots(
  verein: PortalVerein,
  serviceId: number,
  date: string,
): Promise<{ slots: PortalSlot[]; note?: string; error?: string; daylight?: { sunrise: string | null; sunset: string | null } }> {
  const bookable = verein.bookableServices.find((s) => s.serviceId === serviceId);
  if (bookable?.daylight) {
    const day = await loadDaylightBusy(verein, bookable, date);
    const sun = { sunrise: day.grid.sunrise, sunset: day.grid.sunset };
    if (!day.ok) return { slots: [], error: day.error, daylight: sun };
    return { slots: daylightSlotStates(day.grid.slots, { mine: day.mine, busy: day.busy }), daylight: sun };
  }
  const result = await loadServiceSlots(verein.accountId, serviceId, date);
  if (result.status !== 200) return { slots: [], error: String(result.body.error ?? "Slots nicht verfügbar") };
  if (result.body.serviceType === "day") {
    return { slots: [], note: "Dieser Service wird tageweise gebucht und ist hier nicht buchbar." };
  }
  const [mine, blocks] = await Promise.all([
    prisma.vereinSlotBooking.findMany({
      where: { accountId: verein.accountId, vereinId: verein.id, serviceId, date, status: "BOOKED" },
      select: { slotStart: true },
    }),
    prisma.slotBlock.findMany({
      where: { accountId: verein.accountId, serviceId, date },
      select: { slotStart: true },
    }),
  ]);
  const slots = portalSlotStates(result.body.slots ?? [], {
    mine: new Set(mine.map((b) => b.slotStart)),
    blocked: new Set(blocks.map((b) => b.slotStart)),
  });
  return {
    slots,
    ...(result.body.error ? { error: "Buchungssystem gerade nicht erreichbar. Versuche es gleich noch einmal." } : {}),
  };
}

/** Länge eines Tageslicht-Slots: Gültigkeitsdauer des Service, sonst 60 Min. */
function daylightSlotMinutes(bookable: PortalVerein["bookableServices"][number]): number {
  const minutes = bookable.service.defaultValidityDurationMinutes;
  return minutes && minutes >= 15 && minutes <= 240 ? minutes : 60;
}

/**
 * Tageslicht-Slots eines Tages plus alles, was sie belegt: Buchungen und
 * Sperren in anny auf der Resource, Sperren und Vereinsbuchungen in EMP.
 * Ist anny nicht erreichbar, gilt der Tag als unbekannt (`ok: false`).
 */
async function loadDaylightBusy(
  verein: PortalVerein,
  bookable: PortalVerein["bookableServices"][number],
  date: string,
): Promise<{ grid: DaylightDay; ok: true; busy: Interval[]; mine: Interval[] } | { grid: DaylightDay; ok: false; error: string }> {
  const lat = verein.account.latitude ?? 51.756;
  const lng = verein.account.longitude ?? 8.043;
  const grid = daylightDay(date, lat, lng, daylightSlotMinutes(bookable));
  if (grid.slots.length === 0) return { grid, ok: true, busy: [], mine: [] };

  const { start: dayStart, endExclusive: dayEnd } = berlinDayRange(date);
  const [target, bookings, blocks] = await Promise.all([
    resolveAnnyServiceResource(verein.accountId, bookable.serviceId),
    prisma.vereinSlotBooking.findMany({
      where: {
        accountId: verein.accountId,
        serviceId: bookable.serviceId,
        status: "BOOKED",
        startDate: { lt: dayEnd },
        endDate: { gt: dayStart },
      },
      select: { vereinId: true, startDate: true, endDate: true },
    }),
    prisma.slotBlock.findMany({
      where: { accountId: verein.accountId, serviceId: bookable.serviceId, date },
      select: { startDate: true, endDate: true },
    }),
  ]);
  if (!target.ok) return { grid, ok: false, error: "Buchungssystem gerade nicht erreichbar. Versuche es gleich noch einmal." };
  const [anny, related] = await Promise.all([
    fetchAnnyResourceBusy(target.baseUrl, target.token, target.resourceUuid, date, target.organizationId),
    loadRelatedBusy(verein.accountId, target, date, dayStart, dayEnd),
  ]);
  if (!anny.ok || !related.ok) {
    return { grid, ok: false, error: "Buchungssystem gerade nicht erreichbar. Versuche es gleich noch einmal." };
  }

  const toInterval = (b: { startDate: Date; endDate: Date }): Interval => ({ start: b.startDate.getTime(), end: b.endDate.getTime() });
  return {
    grid,
    ok: true,
    mine: bookings.filter((b) => b.vereinId === verein.id).map(toInterval),
    busy: [...anny.intervals, ...related.intervals, ...bookings.map(toInterval), ...blocks.map(toInterval)],
  };
}

/**
 * Belegung durch Kurse und Mieten auf Nachbar-Ressourcen derselben Anlage
 * (siehe `verein-related-bookings.ts`). Live aus anny wie die Ziel-Ressource,
 * dazu die Tickets: ein Ferienkurs beginnt Tage vorher, anny liefert aber nur
 * Buchungen, die am Tag oder am Vortag beginnen. Ist anny nicht erreichbar,
 * gilt der Tag als unbekannt.
 */
async function loadRelatedBusy(
  accountId: number,
  target: { baseUrl: string; token: string; organizationId: string | null; resourceUuid: string },
  date: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<{ ok: true; intervals: Interval[] } | { ok: false }> {
  const profiles = await prisma.operatingSchedule.findMany({
    where: { accountId, annyResourceId: { not: null } },
    include: scheduleSpecInclude,
  });
  const related = relatedResources(
    profiles.map((p) => ({
      annyResourceId: p.annyResourceId,
      parentId: p.parentId,
      facilities: p.facilities,
      spec: toScheduleSpec(p),
    })),
    target.resourceUuid,
  );
  if (related.length === 0) return { ok: true, intervals: [] };
  const ids = related.map((r) => r.resourceId);
  const [live, tickets] = await Promise.all([
    Promise.all(ids.map((id) => fetchAnnyResourceBusy(target.baseUrl, target.token, id, date, target.organizationId))),
    prisma.ticket.findMany({
      where: {
        accountId,
        annyResourceId: { in: ids },
        status: { notIn: ["CANCELED", "INVALID", "PAUSED"] },
        startDate: { lt: dayEnd },
        endDate: { gt: dayStart },
      },
      select: { annyResourceId: true, startDate: true, endDate: true },
    }),
  ]);
  if (live.some((r) => !r.ok)) return { ok: false };
  const intervals = related.flatMap((r, i) => {
    const fromTickets = tickets
      .filter((t) => t.annyResourceId === r.resourceId && t.startDate && t.endDate)
      .map((t) => ({ start: t.startDate!.getTime(), end: t.endDate!.getTime() }));
    return clipToProfileSpans([...live[i].intervals, ...fromTickets], r.specs, date);
  });
  return { ok: true, intervals };
}

/**
 * Obergrenzen des Vereins (offene Buchungen, Inklusivmieten je Monat) vor
 * einer neuen Buchung oder Anfrage. Ohne gesetzte Grenze keine Abfrage.
 */
async function checkPortalLimits(
  verein: PortalVerein,
  booking: { date: string; inclusive: boolean },
): Promise<string | null> {
  const limits = {
    maxOpenBookings: verein.portalMaxOpenBookings,
    maxInclusivePerMonth: verein.portalMaxInclusivePerMonth,
  };
  const needOpen = limits.maxOpenBookings != null;
  const needInclusive = booking.inclusive && limits.maxInclusivePerMonth != null;
  if (!needOpen && !needInclusive) return null;
  const base = { accountId: verein.accountId, vereinId: verein.id, status: { in: ["BOOKED" as const, "REQUESTED" as const] } };
  const [openBookings, inclusiveInMonth] = await Promise.all([
    needOpen ? prisma.vereinSlotBooking.count({ where: { ...base, endDate: { gt: new Date() } } }) : Promise.resolve(0),
    needInclusive
      ? prisma.vereinSlotBooking.count({
          where: { ...base, inclusive: true, priceCents: 0, date: { startsWith: `${booking.date.slice(0, 7)}-` } },
        })
      : Promise.resolve(0),
  ]);
  return portalLimitError(limits, { openBookings, inclusiveInMonth }, booking);
}

export type BookingOutcome =
  | { ok: true; bookingId: number }
  | { ok: false; status: number; error: string };

/** Bucht einen Slot fuer den Verein. Prueft Freigabe, Fenster und Verfuegbarkeit selbst. */
export async function createVereinBooking(
  verein: PortalVerein,
  input: {
    serviceId: number;
    date: string;
    slotStart: string;
    bookedBy: string | null;
    bookedFor: string | null;
    note: string | null;
    inclusive?: boolean;
  },
): Promise<BookingOutcome> {
  const bookable = verein.bookableServices.find((s) => s.serviceId === input.serviceId);
  if (!bookable) return { ok: false, status: 403, error: "Dieser Service ist für euren Verein nicht freigegeben." };
  const price = bookingPrice(bookable, input.inclusive);
  if (!price.ok) return { ok: false, status: 403, error: price.error };
  if (!isDateBookable(input.date, verein.portalHorizonDays)) {
    return { ok: false, status: 400, error: `Buchbar sind nur die nächsten ${verein.portalHorizonDays} Tage.` };
  }
  const limitError = await checkPortalLimits(verein, { date: input.date, inclusive: price.inclusive });
  if (limitError) return { ok: false, status: 409, error: limitError };

  if (bookable.daylight) {
    // Tageslicht: Slot aus dem eigenen Raster, Belegung frisch aus anny und EMP.
    const day = await loadDaylightBusy(verein, bookable, input.date);
    if (!day.ok) return { ok: false, status: 503, error: day.error };
    const slot = day.grid.slots.find((s) => s.startTime === input.slotStart);
    if (!slot) return { ok: false, status: 409, error: "Diesen Slot gibt es nicht (mehr). Bitte neu laden." };
    const range = { start: new Date(slot.startIso).getTime(), end: new Date(slot.endIso).getTime() };
    if (range.start <= Date.now()) return { ok: false, status: 409, error: "Der Slot hat schon begonnen." };
    if (day.busy.some((b) => overlaps(range, b))) return { ok: false, status: 409, error: "Der Slot ist inzwischen belegt." };
    return finalizeVereinBooking(verein, {
      serviceId: input.serviceId,
      serviceName: bookable.service.name,
      date: input.date,
      slotStart: slot.startTime,
      slotEnd: slot.endTime,
      startIso: slot.startIso,
      endIso: slot.endIso,
      priceCents: price.priceCents,
      inclusive: price.inclusive,
      bookedBy: input.bookedBy,
      bookedFor: input.bookedFor,
      note: input.note,
    });
  }

  // Verfuegbarkeit serverseitig neu pruefen; Endzeit und ISO-Zeiten kommen
  // aus ANNY, nicht vom Client.
  const slotsResult = await loadServiceSlots(verein.accountId, input.serviceId, input.date);
  const slot = (slotsResult.body.slots ?? []).find((s) => s.startTime === input.slotStart);
  if (!slot) return { ok: false, status: 409, error: "Diesen Slot gibt es nicht (mehr). Bitte neu laden." };
  if (new Date(slot.startIso).getTime() <= Date.now()) {
    return { ok: false, status: 409, error: "Der Slot hat schon begonnen." };
  }
  if (slot.available === false) return { ok: false, status: 409, error: "Der Slot ist inzwischen belegt." };

  const [existingBlock, existingBooking] = await Promise.all([
    prisma.slotBlock.findFirst({
      where: { accountId: verein.accountId, serviceId: input.serviceId, date: input.date, slotStart: input.slotStart },
      select: { id: true },
    }),
    prisma.vereinSlotBooking.findFirst({
      where: {
        accountId: verein.accountId,
        serviceId: input.serviceId,
        date: input.date,
        slotStart: input.slotStart,
        status: "BOOKED",
      },
      select: { id: true },
    }),
  ]);
  if (existingBlock || existingBooking) return { ok: false, status: 409, error: "Der Slot ist inzwischen belegt." };

  return finalizeVereinBooking(verein, {
    serviceId: input.serviceId,
    serviceName: bookable.service.name,
    date: input.date,
    slotStart: input.slotStart,
    slotEnd: slot.endTime,
    startIso: slot.startIso,
    endIso: slot.endIso,
    priceCents: price.priceCents,
    inclusive: price.inclusive,
    bookedBy: input.bookedBy,
    bookedFor: input.bookedFor,
    note: input.note,
  });
}

/** Felder des Vereins, die eine Buchung braucht. */
export interface VereinCore {
  id: number;
  name: string;
  accountId: number;
  portalLeadMinutes: number;
  portalTrailMinutes: number;
}

interface FinalizeInput {
  serviceId: number;
  serviceName: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  startIso: string;
  endIso: string;
  priceCents: number;
  inclusive: boolean;
  bookedBy: string | null;
  bookedFor: string | null;
  note: string | null;
}

/**
 * Macht eine Buchung wirksam: Sperre in ANNY, Zutritts-Ticket (Slot plus
 * Vor-/Nachbereitung) und Buchungsdatensatz. Mit `requestId` wird eine
 * freigegebene Anfrage zur Buchung, sonst entsteht ein neuer Datensatz.
 */
async function finalizeVereinBooking(
  verein: VereinCore,
  input: FinalizeInput,
  opts: { requestId?: number } = {},
): Promise<BookingOutcome> {
  const blocked = await blockServiceSlot(verein.accountId, {
    serviceId: input.serviceId,
    date: input.date,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
    reason: `Verein ${verein.name}`,
  });
  if (blocked.alreadyBlocked) return { ok: false, status: 409, error: "Der Slot ist inzwischen belegt." };
  if (blocked.status !== 200 || blocked.blockId == null) {
    const detail = typeof blocked.body.error === "string" ? ` (${blocked.body.error})` : "";
    return { ok: false, status: 502, error: `Buchung konnte nicht im Buchungssystem eingetragen werden${detail}. Bitte später erneut versuchen.` };
  }
  const blockId = blocked.blockId;

  try {
    const service = await prisma.service.findFirst({
      where: { id: input.serviceId, accountId: verein.accountId },
      select: { name: true, mainAccessAreaId: true, serviceAreas: { select: { accessAreaId: true }, orderBy: { id: "asc" } } },
    });
    const serviceName = service?.name ?? input.serviceName;
    const areaIds = service?.serviceAreas.map((sa) => sa.accessAreaId) ?? [];
    const mainAreaId = service?.mainAccessAreaId ?? areaIds[0] ?? null;
    const offset = berlinOffset(input.date);
    // Mitglieder kommen schon zur Vorbereitung rein und nach der
    // Nachbereitung noch raus: Ticket-Fenster = Slot plus Puffer.
    const window = accessWindow(new Date(input.startIso), new Date(input.endIso), verein.portalLeadMinutes, verein.portalTrailMinutes);

    const booking = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          accountId: verein.accountId,
          name: `${verein.name} · ${serviceName}`,
          ticketTypeName: "Vereinsbuchung",
          validityType: "TIME_SLOT",
          startDate: new Date(`${input.date}T00:00:00${offset}`),
          endDate: new Date(`${input.date}T23:59:59${offset}`),
          slotStart: clampedBerlinHm(window.from, input.date, "start"),
          slotEnd: clampedBerlinHm(window.to, input.date, "end"),
          accessAreaId: mainAreaId,
          status: "VALID",
          notes: [
            input.bookedBy ? `Gebucht im Vereinsportal von ${input.bookedBy}` : "Gebucht im Vereinsportal",
            input.bookedFor ? `für ${input.bookedFor}` : null,
            input.inclusive ? "Inklusivmiete" : null,
          ].filter(Boolean).join(", "),
          ...(areaIds.length > 0 && {
            ticketAreas: { create: areaIds.map((accessAreaId) => ({ accessAreaId })) },
          }),
        },
        select: { id: true },
      });
      await tx.vereinAccessTicket.create({ data: { vereinId: verein.id, ticketId: ticket.id } });
      const data = {
        serviceName,
        slotStart: input.slotStart,
        slotEnd: input.slotEnd,
        startDate: new Date(input.startIso),
        endDate: new Date(input.endIso),
        priceCents: input.priceCents,
        inclusive: input.inclusive,
        slotBlockId: blockId,
        accessTicketId: ticket.id,
      };
      if (opts.requestId != null) {
        return tx.vereinSlotBooking.update({
          where: { id: opts.requestId },
          data: { ...data, status: "BOOKED", decidedAt: new Date() },
          select: { id: true },
        });
      }
      return tx.vereinSlotBooking.create({
        data: {
          ...data,
          accountId: verein.accountId,
          vereinId: verein.id,
          serviceId: input.serviceId,
          date: input.date,
          bookedBy: input.bookedBy,
          bookedFor: input.bookedFor,
          note: input.note,
        },
        select: { id: true },
      });
    });
    return { ok: true, bookingId: booking.id };
  } catch (e) {
    // Sperre wieder freigeben, sonst bleibt der Slot ohne Buchung belegt.
    const block = await prisma.slotBlock.findFirst({ where: { id: blockId, accountId: verein.accountId } });
    if (block) await releaseSlotBlock(verein.accountId, block).catch(() => null);
    throw e;
  }
}

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Wunschzeit-Anfrage: der Verein moechte eine Zeit, die nicht als freier
 * Slot angeboten wird (z. B. Uebungslift 10-11 Uhr). Sie wartet auf die
 * Freigabe im Backoffice; das Backoffice bekommt eine Push-Meldung.
 */
export async function createVereinRequest(
  verein: PortalVerein,
  input: {
    serviceId: number;
    date: string;
    start: string;
    end: string;
    bookedBy: string | null;
    bookedFor: string | null;
    note: string | null;
    inclusive?: boolean;
  },
): Promise<BookingOutcome> {
  const bookable = verein.bookableServices.find((s) => s.serviceId === input.serviceId);
  if (!bookable) return { ok: false, status: 403, error: "Dieser Service ist für euren Verein nicht freigegeben." };
  const price = bookingPrice(bookable, input.inclusive);
  if (!price.ok) return { ok: false, status: 403, error: price.error };
  if (!isDateBookable(input.date, verein.portalHorizonDays)) {
    return { ok: false, status: 400, error: `Anfragen gehen nur für die nächsten ${verein.portalHorizonDays} Tage.` };
  }
  if (!HM_RE.test(input.start) || !HM_RE.test(input.end) || input.end <= input.start) {
    return { ok: false, status: 400, error: "Bitte eine Uhrzeit von–bis angeben, das Ende nach dem Beginn." };
  }
  const offset = berlinOffset(input.date);
  const startDate = new Date(`${input.date}T${input.start}:00${offset}`);
  const endDate = new Date(`${input.date}T${input.end}:00${offset}`);
  if (startDate.getTime() <= Date.now()) return { ok: false, status: 400, error: "Die Zeit liegt in der Vergangenheit." };
  const limitError = await checkPortalLimits(verein, { date: input.date, inclusive: price.inclusive });
  if (limitError) return { ok: false, status: 409, error: limitError };

  const open = await prisma.vereinSlotBooking.count({
    where: { accountId: verein.accountId, vereinId: verein.id, status: "REQUESTED" },
  });
  if (open >= 20) return { ok: false, status: 429, error: "Es warten schon viele Anfragen. Bitte wartet auf unsere Antwort." };

  const request = await prisma.vereinSlotBooking.create({
    data: {
      accountId: verein.accountId,
      vereinId: verein.id,
      serviceId: input.serviceId,
      serviceName: bookable.service.name,
      date: input.date,
      slotStart: input.start,
      slotEnd: input.end,
      startDate,
      endDate,
      priceCents: price.priceCents,
      inclusive: price.inclusive,
      status: "REQUESTED",
      bookedBy: input.bookedBy,
      bookedFor: input.bookedFor,
      note: input.note,
    },
    select: { id: true },
  });

  const [y, m, d] = input.date.split("-");
  await sendPushToAccount(verein.accountId, {
    title: `Anfrage von ${verein.name}`,
    body: `${bookable.service.name} am ${d}.${m}.${y}, ${input.start}–${input.end} Uhr${input.bookedBy ? ` · ${input.bookedBy}` : ""}`,
    url: "/vereine/buchungen",
    tag: `verein-request-${request.id}`,
  }).catch((e) => console.error("[verein-portal] push failed:", e));
  await sendRequestToTelegram(verein.accountId, request.id, {
    vereinName: verein.name,
    serviceName: bookable.service.name,
    date: input.date,
    slotStart: input.start,
    slotEnd: input.end,
    priceCents: price.priceCents,
    inclusive: price.inclusive,
    bookedBy: input.bookedBy,
    bookedFor: input.bookedFor,
    note: input.note,
  }).catch((e) => console.error("[verein-portal] telegram failed:", e));

  return { ok: true, bookingId: request.id };
}

/**
 * Gibt eine Anfrage frei: sperrt die Zeit in ANNY, legt das Zutritts-Ticket
 * an und macht daraus eine abrechenbare Buchung. `priceCents` ueberschreibt
 * den Preis-Schnappschuss der Anfrage.
 */
export async function approveVereinRequest(
  accountId: number,
  requestId: number,
  opts: { priceCents?: number } = {},
): Promise<BookingOutcome> {
  const request = await prisma.vereinSlotBooking.findFirst({
    where: { id: requestId, accountId, status: "REQUESTED" },
    include: {
      verein: { select: { id: true, name: true, accountId: true, portalLeadMinutes: true, portalTrailMinutes: true } },
    },
  });
  if (!request) return { ok: false, status: 404, error: "Anfrage nicht gefunden oder schon entschieden." };
  if (request.serviceId == null) return { ok: false, status: 409, error: "Der Service der Anfrage existiert nicht mehr." };
  if (request.endDate.getTime() <= Date.now()) return { ok: false, status: 409, error: "Die angefragte Zeit ist schon vorbei." };

  // Ueberschneidung mit einer anderen Vereinsbuchung desselben Service?
  const clash = await prisma.vereinSlotBooking.findFirst({
    where: {
      accountId,
      serviceId: request.serviceId,
      status: "BOOKED",
      id: { not: request.id },
      startDate: { lt: request.endDate },
      endDate: { gt: request.startDate },
    },
    include: { verein: { select: { name: true } } },
  });
  if (clash) {
    return { ok: false, status: 409, error: `Überschneidet sich mit ${clash.verein.name} (${clash.slotStart}–${clash.slotEnd}).` };
  }

  return finalizeVereinBooking(
    request.verein,
    {
      serviceId: request.serviceId,
      serviceName: request.serviceName,
      date: request.date,
      slotStart: request.slotStart,
      slotEnd: request.slotEnd,
      startIso: request.startDate.toISOString(),
      endIso: request.endDate.toISOString(),
      priceCents: opts.priceCents ?? request.priceCents,
      // Setzt das Backoffice beim Freigeben einen Preis, ist es keine Inklusivmiete mehr.
      inclusive: request.inclusive && (opts.priceCents ?? request.priceCents) === 0,
      bookedBy: request.bookedBy,
      bookedFor: request.bookedFor,
      note: request.note,
    },
    { requestId: request.id },
  );
}

/** Lehnt eine Anfrage ab; die Begruendung sieht der Verein im Portal. */
export async function rejectVereinRequest(
  accountId: number,
  requestId: number,
  reason: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const res = await prisma.vereinSlotBooking.updateMany({
    where: { id: requestId, accountId, status: "REQUESTED" },
    data: { status: "REJECTED", rejectReason: reason, decidedAt: new Date() },
  });
  if (res.count === 0) return { ok: false, status: 404, error: "Anfrage nicht gefunden oder schon entschieden." };
  return { ok: true };
}

/**
 * Storniert eine Vereinsbuchung: hebt die ANNY-Sperre auf, entwertet das
 * Zutritts-Ticket und markiert die Buchung als storniert (wird nicht
 * abgerechnet). `by` = "VEREIN" prueft die Storno-Frist.
 */
export async function cancelVereinBooking(
  accountId: number,
  bookingId: number,
  by: "VEREIN" | "ADMIN",
  opts: { vereinId?: number } = {},
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const booking = await prisma.vereinSlotBooking.findFirst({
    where: { id: bookingId, accountId, ...(opts.vereinId != null ? { vereinId: opts.vereinId } : {}) },
    include: { verein: { select: { portalCancelHours: true } }, slotBlock: true },
  });
  if (!booking) return { ok: false, status: 404, error: "Buchung nicht gefunden." };
  if (booking.status === "CANCELED") return { ok: true };
  if (booking.status === "REJECTED") return { ok: false, status: 409, error: "Die Anfrage wurde schon abgelehnt." };
  if (by === "VEREIN" && booking.status === "BOOKED") {
    if (!canVereinCancel(booking.startDate, booking.verein.portalCancelHours)) {
      return {
        ok: false,
        status: 409,
        error: `Stornieren geht nur bis ${booking.verein.portalCancelHours} Stunden vorher. Bitte meldet euch direkt bei uns.`,
      };
    }
  }
  if (booking.billedAt) return { ok: false, status: 409, error: "Die Buchung ist schon abgerechnet." };

  // Nur zukuenftige Slots in ANNY freigeben; vergangene Sperren sind egal.
  if (booking.slotBlock && booking.endDate.getTime() > Date.now()) {
    const released = await releaseSlotBlock(accountId, booking.slotBlock);
    if (released.status !== 200) {
      return { ok: false, status: 502, error: "Slot konnte im Buchungssystem nicht freigegeben werden. Bitte erneut versuchen." };
    }
  }

  await prisma.$transaction(async (tx) => {
    if (booking.accessTicketId) {
      await tx.vereinAccessTicket.deleteMany({ where: { vereinId: booking.vereinId, ticketId: booking.accessTicketId } });
      await tx.ticket.updateMany({
        where: { id: booking.accessTicketId, accountId },
        data: { status: "CANCELED" },
      });
    }
    await tx.vereinSlotBooking.update({
      where: { id: booking.id },
      data: { status: "CANCELED", canceledAt: new Date(), canceledBy: by },
    });
  });
  return { ok: true };
}

/** Geraetetypen, die als Tuer/Tor oeffnen koennen (keine Lampen, Ventile, Maeher). */
export const PORTAL_OPENABLE_TYPES = ["SHELLY", "NUKI_SMARTLOCK", "LOQED_SMARTLOCK", "RASPBERRY_PI"] as const;

export interface PortalAccessPoint {
  kind: "device" | "doorbird";
  id: number;
  name: string;
}

/** Freigegebene Tueren/Tore des Vereins (nur noch existierende). */
export async function loadPortalAccessPoints(verein: PortalVerein): Promise<PortalAccessPoint[]> {
  const [devices, doorbirds] = await Promise.all([
    verein.portalDeviceIds.length
      ? prisma.device.findMany({
          where: { accountId: verein.accountId, id: { in: verein.portalDeviceIds }, type: { in: [...PORTAL_OPENABLE_TYPES] } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
    verein.portalDoorbirdIds.length
      ? prisma.camera.findMany({
          where: { accountId: verein.accountId, id: { in: verein.portalDoorbirdIds }, kind: "DOORBIRD" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);
  return [
    ...doorbirds.map((c) => ({ kind: "doorbird" as const, id: c.id, name: c.name })),
    ...devices.map((d) => ({ kind: "device" as const, id: d.id, name: d.name })),
  ];
}

/** Buchung, deren Zugangsfenster gerade laeuft (oder null). */
export async function activeAccessBooking(verein: PortalVerein, now: Date = new Date()) {
  return prisma.vereinSlotBooking.findFirst({
    where: {
      accountId: verein.accountId,
      vereinId: verein.id,
      status: "BOOKED",
      startDate: { lte: new Date(now.getTime() + verein.portalLeadMinutes * 60_000) },
      endDate: { gte: new Date(now.getTime() - verein.portalTrailMinutes * 60_000) },
    },
    orderBy: { startDate: "asc" },
    select: { id: true, startDate: true, endDate: true, accessTicketId: true },
  });
}

/**
 * Oeffnet eine freigegebene Tuer/ein Tor aus dem Portal - nur im
 * Zugangsfenster einer Buchung. Jeder Versuch steht im Scan-Verlauf
 * (Geraete) bzw. als Hub-Task (DoorBird).
 */
export async function openPortalAccessPoint(
  verein: PortalVerein,
  target: { kind: "device" | "doorbird"; id: number },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const allowed = target.kind === "device" ? verein.portalDeviceIds : verein.portalDoorbirdIds;
  if (!allowed.includes(target.id)) return { ok: false, status: 403, error: "Dieser Zugang ist für euren Verein nicht freigegeben." };
  const booking = await activeAccessBooking(verein);
  if (!booking) {
    return { ok: false, status: 403, error: "Öffnen geht nur rund um eure gebuchte Zeit." };
  }
  const code = `verein:${verein.id}:open`;

  if (target.kind === "doorbird") {
    const camera = await prisma.camera.findFirst({
      where: { id: target.id, accountId: verein.accountId, kind: "DOORBIRD" },
      select: { id: true, name: true },
    });
    if (!camera) return { ok: false, status: 404, error: "Tor nicht gefunden." };
    await prisma.hubTask.create({
      data: { type: "DOORBIRD_OPEN", payload: { cameraId: camera.id, relay: 1, source: code }, accountId: verein.accountId },
    });
    // Kamera-Tueren haben keine Device-Zeile: deviceId 0, Kamera im Namen.
    recordDeviceAction({
      accountId: verein.accountId,
      deviceId: 0,
      deviceName: `${camera.name ?? "Kamera"} (Kamera ${camera.id})`,
      action: "doorbird_open",
      result: "ok",
      by: { source: "verein", actorLabel: `verein:${verein.id}` },
    });
    return { ok: true };
  }

  const device = await prisma.device.findFirst({
    where: { id: target.id, accountId: verein.accountId, type: { in: [...PORTAL_OPENABLE_TYPES] } },
    select: {
      id: true, name: true, type: true, category: true, shellyId: true, ipAddress: true,
      coverUpChannel: true, coverDownChannel: true, coverRuntimeSec: true, pulseSeconds: true,
      nukiSmartlockId: true, loqedLockId: true, gardenaServiceId: true, gardenaConfigId: true, pumpDeviceId: true,
    },
  });
  if (!device || !isActionAllowedForDevice("open", device)) return { ok: false, status: 404, error: "Tür nicht gefunden." };

  let sent = false;
  let error: string | undefined;
  try {
    const res = await triggerDeviceAction(tenantClient(verein.accountId), device, verein.accountId, "open", {
      actor: { source: "verein", actorLabel: `verein:${verein.id}` },
    });
    sent = res.sent;
    error = res.error;
  } catch (e) {
    error = e instanceof Error ? e.message : "unbekannt";
  }
  const remote = deviceSendsRemoteCommand(device.type);
  const granted = !remote || sent;
  await prisma.scan.create({
    data: {
      accountId: verein.accountId,
      deviceId: device.id,
      ticketId: booking.accessTicketId,
      code,
      note: granted ? `Vereinsportal ${verein.name}` : `Vereinsportal ${verein.name}: ${error ?? "Gerät antwortete nicht"}`.slice(0, 250),
      result: granted ? "GRANTED" : "DENIED",
    },
  });
  if (!granted) return { ok: false, status: 502, error: "Tür nicht erreichbar. Bitte noch einmal versuchen." };
  return { ok: true };
}
