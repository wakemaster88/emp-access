import type { PrismaClient } from "@prisma/client";
import { berlinDayStart, berlinYmd } from "@/lib/berlin-day";

const MAX_TICKETS = 2500;

/** Laengstes Zeitfenster, das noch als Tagestermin (statt Tages-/Mehrtageskarte)
 *  gilt - identisch zur Slot-Label-Heuristik in `monitor-ticket-subtitle.ts`. */
const DAY_APPOINTMENT_MAX_MS = 8 * 60 * 60 * 1000;

type SeriesCandidate = {
  uuid: string | null;
  serviceId: number | null;
  startDate: Date | null;
  endDate: Date | null;
  validityType: string;
};

/** Schluessel "ANNY-Kunde + Service" – Sammelbuchung und Tagestermine einer
 *  Kursbuchung teilen ihn, weil sie sich nur in der Booking-ID unterscheiden. */
function annySeriesKey(t: SeriesCandidate): string | null {
  if (!t.uuid?.startsWith("anny:") || t.serviceId == null) return null;
  const customerId = t.uuid.split(":")[1];
  return customerId ? `${customerId}|${t.serviceId}` : null;
}

/** Buchung fuer genau den heutigen Kurstag (z.B. Ferienkurs 10:00–12:00). */
function isDayAppointmentToday(t: SeriesCandidate, todayYmd: string): boolean {
  if (t.validityType === "DURATION" || !t.startDate || !t.endDate) return false;
  if (berlinYmd(t.startDate) !== todayYmd || berlinYmd(t.endDate) !== todayYmd) return false;
  const durationMs = t.endDate.getTime() - t.startDate.getTime();
  return durationMs > 0 && durationMs <= DAY_APPOINTMENT_MAX_MS;
}

export type PublicMonitorPollResult = {
  name: string;
  devices: Awaited<ReturnType<typeof loadDevices>>;
  scans: Awaited<ReturnType<typeof loadScans>>;
  tickets: Awaited<ReturnType<typeof loadTickets>> | null;
  /** Höchste Scan-ID in dieser Antwort (für sinceScanId beim nächsten Poll) */
  lastScanId: number;
  /**
   * Aktive (noch nicht dismissed) Banner-Hinweise des Accounts. Werden vom
   * Public-Monitor als Banner oben angezeigt und account-weit per Klick auf
   * X dismissed. Bei `scansOnly=true` weggelassen (sparen Round-trip).
   */
  announcements: Awaited<ReturnType<typeof loadAnnouncements>> | null;
};

async function loadAnnouncements(prisma: PrismaClient, accountId: number) {
  return prisma.monitorAnnouncement.findMany({
    where: { accountId, dismissedAt: null },
    select: { id: true, message: true, sourceLabel: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

/**
 * deviceFilter-Semantik (geteilt von Scans/Geraeten):
 *   null      -> kein Filter (alle Geraete des Accounts, Legacy-Verhalten)
 *   []        -> explizit keine Geraete (z.B. bereichseingegrenzter Monitor
 *                ohne eigenes Scan-Geraet) -> liefert nichts
 *   [ids...]  -> genau diese Geraete
 */
async function loadDevices(
  prisma: PrismaClient,
  accountId: number,
  deviceFilter: number[] | null
) {
  return prisma.device.findMany({
    where: { accountId, ...(deviceFilter === null ? {} : { id: { in: deviceFilter } }) },
    select: { id: true, name: true, type: true, isActive: true, lastUpdate: true, task: true, accessIn: true, accessOut: true },
  });
}

async function loadScans(
  prisma: PrismaClient,
  accountId: number,
  deviceFilter: number[] | null,
  sinceScanId: number
) {
  const scanWhere: Record<string, unknown> = {
    accountId,
    ...(deviceFilter === null ? {} : { deviceId: { in: deviceFilter } }),
    ...(sinceScanId > 0
      ? { id: { gt: sinceScanId } }
      : { scanTime: { gte: berlinDayStart() } }),
  };
  return prisma.scan.findMany({
    where: scanWhere,
    include: {
      device: { select: { id: true, name: true } },
      ticket: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          birthDate: true,
          ticketTypeName: true,
          validityType: true,
          validityDurationMinutes: true,
          firstScanAt: true,
          endDate: true,
          subscriptionId: true,
          serviceId: true,
          status: true,
          profileImage: true,
          subscription: { select: { name: true } },
          service: { select: { name: true } },
        },
      },
    },
    orderBy: { id: "desc" },
    take: sinceScanId === 0 ? 50 : 25,
  });
}

async function loadTickets(
  prisma: PrismaClient,
  accountId: number,
  devices: { accessIn: number | null; accessOut: number | null }[],
  extraAreaIds: number[] = [],
  // strict=true: Monitor ist EXPLIZIT auf Bereiche eingegrenzt (areaIds vom
  // Nutzer gewaehlt) -> nur Tickets zeigen, die wirklich zu diesen Bereichen
  // gehoeren. Die Universal-/Catch-all-Tickets ohne jede Bereichszuordnung
  // werden dann NICHT mit eingeblendet.
  strict = false
) {
  const cachedAreaIds = [...new Set([
    ...devices.flatMap((d) => [d.accessIn, d.accessOut].filter((id): id is number => id != null)),
    ...extraAreaIds,
  ])];
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const ticketWhere: Record<string, unknown> = {
    accountId,
    status: { in: ["VALID", "REDEEMED", "PAUSED"] },
    OR: [{ startDate: null }, { startDate: { lte: todayEnd } }],
    AND: [
      { OR: [{ endDate: null }, { endDate: { gte: todayStart } }] },
    ],
  };
  if (strict) {
    // Bei strikter Bereichseingrenzung (explizit gewaehlte areaIds) sollen
    // Mitarbeiter-Tickets (EMP_CONTROL-Importe ohne echte Bereichszuordnung,
    // ticketTypeName="Mitarbeiter") NICHT auf dem Monitor erscheinen.
    (ticketWhere.AND as Record<string, unknown>[]).push({
      NOT: { ticketTypeName: { equals: "Mitarbeiter", mode: "insensitive" } },
    });
  }
  if (cachedAreaIds.length > 0) {
    // Vereinsmitglieder erben die Areas IHRES Vereins-Zutritts-Tickets (z.B.
    // "Tristar Oelde -> Strandbad Jahresticket"). Wenn das Zutritts-Ticket
    // keinen Bereich aus diesem Monitor abdeckt, sollen die Mitglieder hier
    // auch NICHT auftauchen - sonst stehen z.B. die Tristar-Strandbad-
    // Mitglieder im Seilbahn-Monitor.
    const vereinAreaFilter = {
      verein: {
        accessTickets: {
          some: {
            ticket: {
              OR: [
                { accessAreaId: { in: cachedAreaIds } },
                { ticketAreas: { some: { accessAreaId: { in: cachedAreaIds } } } },
                { subscription: { areas: { some: { id: { in: cachedAreaIds } } } } },
                { service: { serviceAreas: { some: { accessAreaId: { in: cachedAreaIds } } } } },
              ],
            },
          },
        },
      },
    };
    (ticketWhere.AND as Record<string, unknown>[]).push({
      OR: [
        { accessAreaId: { in: cachedAreaIds } },
        { ticketAreas: { some: { accessAreaId: { in: cachedAreaIds } } } },
        { subscription: { areas: { some: { id: { in: cachedAreaIds } } } } },
        { service: { serviceAreas: { some: { accessAreaId: { in: cachedAreaIds } } } } },
        vereinAreaFilter,
        // Universal-Tickets ohne JEDE Bereichszuordnung (typisch fuer
        // Mitarbeiter ohne Area-Whitelist, EMP_CONTROL-Importe etc.).
        // Vereinsmitglieder werden hier bewusst ausgeschlossen - die laufen
        // ueber den `vereinAreaFilter` oben und erscheinen nur dort, wo der
        // Verein auch wirklich Zugang hat.
        // Bei strikter Bereichseingrenzung (explizit gewaehlte areaIds) werden
        // diese Catch-all-Tickets NICHT eingeblendet.
        ...(strict
          ? []
          : [{
              accessAreaId: null,
              subscriptionId: null,
              serviceId: null,
              vereinId: null,
            }]),
      ],
    });
  }

  // profileImage (Base64) wird NICHT mehr pro Ticket ausgeliefert – würde bei
  // take=2500 ggf. MB-große Payloads pro Poll erzeugen. Stattdessen nur ein
  // hasPhoto-Flag via zweitem schlankem ID-Query; Client lädt das Foto lazy
  // über /api/monitor/public/[token]/photo?ticketId=... bei Bedarf.
  const [rawTickets, ticketIdsWithPhoto] = await Promise.all([
    prisma.ticket.findMany({
      where: ticketWhere,
      select: {
        id: true,
        uuid: true,
        name: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        ticketTypeName: true,
        status: true,
        validityType: true,
        validityDurationMinutes: true,
        firstScanAt: true,
        startDate: true,
        endDate: true,
        slotStart: true,
        slotEnd: true,
        subscriptionId: true,
        serviceId: true,
        source: true,
        extras: true,
        service: {
          select: {
            name: true,
            // serviceAreas.length wird im Frontend zur Gruppierung von
            // ANNY-Multi-Area-Buchungen verwendet (z.B. Aquapark Tageskarte
            // = Aquapark + Strandbad, ergibt pro Person 2 ANNY-bookings).
            serviceAreas: { select: { accessAreaId: true } },
          },
        },
        subscription: { select: { name: true } },
        accessArea: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: MAX_TICKETS,
    }),
    prisma.ticket.findMany({
      where: { ...ticketWhere, profileImage: { not: null } },
      select: { id: true },
      take: MAX_TICKETS,
    }),
  ]);

  const photoIds = new Set(ticketIdsWithPhoto.map((r) => r.id));

  // ANNY bucht Kurse als Serie: eine Sammelbuchung ueber den ganzen Kurszeitraum
  // PLUS eine Buchung pro Kurstag - jede mit eigener Booking-ID, also jede als
  // eigenes Ticket. Damit stand derselbe Teilnehmer zweimal im Monitor: einmal
  // im Slot-Abschnitt des Tagestermins ("10:00–12:00 Uhr") und einmal unter
  // "Ohne feste Uhrzeit", weil die mehrtaegige Sammelbuchung keine Slot-Zeit
  // ableiten kann. Existiert der Tagestermin, ist die Sammelbuchung redundant
  // und wird ausgeblendet; fehlt er, bleibt sie sichtbar - sonst wuerde der
  // Teilnehmer ganz aus der Liste fallen.
  const todayYmd = berlinYmd(now);
  const dayAppointmentKeys = new Set(
    rawTickets
      .filter((t) => isDayAppointmentToday(t, todayYmd))
      .map(annySeriesKey)
      .filter((k): k is string => k != null),
  );

  return rawTickets
    .filter((t) => {
      if (t.validityType === "DURATION" && t.firstScanAt && t.validityDurationMinutes) {
        const expiresAt = new Date(t.firstScanAt).getTime() + t.validityDurationMinutes * 60_000;
        if (now.getTime() > expiresAt) return false;
      }
      if (t.startDate && t.endDate && berlinYmd(t.startDate) !== berlinYmd(t.endDate)) {
        const key = annySeriesKey(t);
        if (key && dayAppointmentKeys.has(key)) return false;
      }
      return true;
    })
    .map((t) => {
      // Service-Areas-Count flach mitspielen (Frontend braucht keine Liste).
      const { service, ...rest } = t;
      const serviceAreaCount = service?.serviceAreas?.length ?? 0;
      return {
        ...rest,
        service: service ? { name: service.name } : null,
        serviceAreaCount,
        hasPhoto: photoIds.has(t.id),
      };
    });
}

/**
 * Ein kurzer Poll (ohne SSE) – hält Vercel & Neon pro Request unter ~10s.
 * scansOnly=true: nur neue Scans laden (1 Query), Devices/Tickets skippen.
 */
export async function runPublicMonitorPoll(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    deviceIds: number[];
    areaIds?: number[];
    monitorName: string;
    sinceScanId: number;
    includeTickets: boolean;
    scansOnly?: boolean;
  }
): Promise<PublicMonitorPollResult> {
  const { accountId, deviceIds, monitorName, sinceScanId, includeTickets, scansOnly } = opts;
  const areaIds = opts.areaIds ?? [];
  const areaScoped = areaIds.length > 0;

  // Geraete-Filter bestimmen:
  // - Geraete gewaehlt -> genau diese.
  // - sonst bereichseingegrenzt -> Geraete dieser Bereiche (kann leer sein ->
  //   dann werden bewusst KEINE Scans gezeigt, statt alle).
  // - sonst Legacy -> kein Filter (alle Geraete).
  let deviceFilter: number[] | null;
  if (deviceIds.length > 0) {
    deviceFilter = deviceIds;
  } else if (areaScoped) {
    const areaDevices = await prisma.device.findMany({
      where: {
        accountId,
        OR: [{ accessIn: { in: areaIds } }, { accessOut: { in: areaIds } }],
      },
      select: { id: true },
    });
    deviceFilter = areaDevices.map((d) => d.id);
  } else {
    deviceFilter = null;
  }

  const scans = await loadScans(prisma, accountId, deviceFilter, sinceScanId);

  let lastScanId = sinceScanId;
  if (scans.length > 0) {
    lastScanId = Math.max(...scans.map((s) => s.id));
  }

  if (scansOnly) {
    return {
      name: monitorName,
      devices: [],
      scans,
      tickets: null,
      lastScanId,
      announcements: null,
    };
  }

  const [devices, announcements] = await Promise.all([
    loadDevices(prisma, accountId, deviceFilter),
    loadAnnouncements(prisma, accountId),
  ]);
  const tickets = includeTickets
    ? await loadTickets(prisma, accountId, devices, areaIds, areaScoped)
    : null;

  return {
    name: monitorName,
    devices,
    scans,
    tickets,
    lastScanId,
    announcements,
  };
}
