import { randomBytes } from "node:crypto";
import { berlinOffset } from "@/lib/anny-availability";
import { loadServiceSlots } from "@/lib/service-slots";
import { blockServiceSlot, releaseSlotBlock } from "@/lib/slot-blocks";
import { prisma, tenantClient } from "@/lib/prisma";
import { deviceSendsRemoteCommand, isActionAllowedForDevice, triggerDeviceAction } from "@/lib/device-open";
import {
  accessWindow,
  canVereinCancel,
  clampedBerlinHm,
  isDateBookable,
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
      account: { select: { name: true } },
      bookableServices: {
        select: { serviceId: true, priceCents: true, service: { select: { id: true, name: true } } },
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
): Promise<{ slots: PortalSlot[]; note?: string; error?: string }> {
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

export type BookingOutcome =
  | { ok: true; bookingId: number }
  | { ok: false; status: number; error: string };

/** Bucht einen Slot fuer den Verein. Prueft Freigabe, Fenster und Verfuegbarkeit selbst. */
export async function createVereinBooking(
  verein: PortalVerein,
  input: { serviceId: number; date: string; slotStart: string; bookedBy: string | null; note: string | null },
): Promise<BookingOutcome> {
  const bookable = verein.bookableServices.find((s) => s.serviceId === input.serviceId);
  if (!bookable) return { ok: false, status: 403, error: "Dieser Service ist für euren Verein nicht freigegeben." };
  if (!isDateBookable(input.date, verein.portalHorizonDays)) {
    return { ok: false, status: 400, error: `Buchbar sind nur die nächsten ${verein.portalHorizonDays} Tage.` };
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

  const blocked = await blockServiceSlot(verein.accountId, {
    serviceId: input.serviceId,
    date: input.date,
    slotStart: input.slotStart,
    slotEnd: slot.endTime,
    reason: `Verein ${verein.name}`,
  });
  if (blocked.alreadyBlocked) return { ok: false, status: 409, error: "Der Slot ist inzwischen belegt." };
  if (blocked.status !== 200 || blocked.blockId == null) {
    return { ok: false, status: 502, error: "Buchung konnte nicht im Buchungssystem eingetragen werden. Bitte später erneut versuchen." };
  }
  const blockId = blocked.blockId;

  try {
    const service = await prisma.service.findFirst({
      where: { id: input.serviceId, accountId: verein.accountId },
      select: { name: true, mainAccessAreaId: true, serviceAreas: { select: { accessAreaId: true }, orderBy: { id: "asc" } } },
    });
    const serviceName = service?.name ?? bookable.service.name;
    const areaIds = service?.serviceAreas.map((sa) => sa.accessAreaId) ?? [];
    const mainAreaId = service?.mainAccessAreaId ?? areaIds[0] ?? null;
    const offset = berlinOffset(input.date);
    // Mitglieder kommen schon zur Vorbereitung rein und nach der
    // Nachbereitung noch raus: Ticket-Fenster = Slot plus Puffer.
    const window = accessWindow(new Date(slot.startIso), new Date(slot.endIso), verein.portalLeadMinutes, verein.portalTrailMinutes);

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
          notes: input.bookedBy ? `Gebucht im Vereinsportal von ${input.bookedBy}` : "Gebucht im Vereinsportal",
          ...(areaIds.length > 0 && {
            ticketAreas: { create: areaIds.map((accessAreaId) => ({ accessAreaId })) },
          }),
        },
        select: { id: true },
      });
      await tx.vereinAccessTicket.create({ data: { vereinId: verein.id, ticketId: ticket.id } });
      return tx.vereinSlotBooking.create({
        data: {
          accountId: verein.accountId,
          vereinId: verein.id,
          serviceId: input.serviceId,
          serviceName,
          date: input.date,
          slotStart: input.slotStart,
          slotEnd: slot.endTime,
          startDate: new Date(slot.startIso),
          endDate: new Date(slot.endIso),
          priceCents: bookable.priceCents,
          bookedBy: input.bookedBy,
          note: input.note,
          slotBlockId: blockId,
          accessTicketId: ticket.id,
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
  if (by === "VEREIN") {
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
      select: { id: true },
    });
    if (!camera) return { ok: false, status: 404, error: "Tor nicht gefunden." };
    await prisma.hubTask.create({
      data: { type: "DOORBIRD_OPEN", payload: { cameraId: camera.id, relay: 1, source: code }, accountId: verein.accountId },
    });
    return { ok: true };
  }

  const device = await prisma.device.findFirst({
    where: { id: target.id, accountId: verein.accountId, type: { in: [...PORTAL_OPENABLE_TYPES] } },
    select: {
      id: true, type: true, category: true, shellyId: true, ipAddress: true,
      coverUpChannel: true, coverDownChannel: true, coverRuntimeSec: true, pulseSeconds: true,
      nukiSmartlockId: true, loqedLockId: true, gardenaServiceId: true, gardenaConfigId: true, pumpDeviceId: true,
    },
  });
  if (!device || !isActionAllowedForDevice("open", device)) return { ok: false, status: 404, error: "Tür nicht gefunden." };

  let sent = false;
  let error: string | undefined;
  try {
    const res = await triggerDeviceAction(tenantClient(verein.accountId), device, verein.accountId, "open");
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
