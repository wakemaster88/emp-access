import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { berlinOffset } from "@/lib/anny-availability";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    include: { account: { select: { id: true, name: true } } },
  });

  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const accountId = monitor.accountId;
  const monitorDeviceIds = (monitor.deviceIds as number[]) ?? [];
  const dateParam = request.nextUrl.searchParams.get("date");
  const now = new Date();
  const berlinDate = dateParam || now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

  const tz = berlinOffset(berlinDate);
  const dayStart = new Date(`${berlinDate}T00:00:00${tz}`);
  const dayEnd = new Date(`${berlinDate}T23:59:59${tz}`);

  const ticketSelect = {
    id: true,
    name: true,
    firstName: true,
    lastName: true,
    birthDate: true,
    ticketTypeName: true,
    status: true,
    validityType: true,
    slotStart: true,
    slotEnd: true,
    validityDurationMinutes: true,
    firstScanAt: true,
    startDate: true,
    endDate: true,
    profileImage: true,
    rfidCode: true,
    barcode: true,
    qrCode: true,
    uuid: true,
    extras: true,
    source: true,
    subscriptionId: true,
    serviceId: true,
    accessAreaId: true,
    vereinId: true,
    // ANNY-Sync-Indikator fuer das TicketCard-Badge: gesetzt wenn das
    // Ticket beim Verkauf in ANNY gegenbucht wurde.
    annyBookingId: true,
    // Freitext-Notiz, wird im Ticket-Overlay angezeigt/editiert.
    notes: true,
    // Antworten aus Info-Anfragen (Label -> Wert), Badges im TicketCard.
    guestInfo: true,
  } as const;

  const [
    tickets,
    allSubscriptions,
    services,
    areas,
    recentScans,
    grantedTicketIdsToday,
    openableDevices,
  ] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        accountId,
        status: { in: ["VALID", "REDEEMED", "PAUSED"] },
        AND: [
          { OR: [{ source: null }, { source: { notIn: ["EMP_CONTROL"] } }] },
          {
            // Tickets ohne jegliches Datum (startDate=null UND endDate=null)
            // werden im Shop-Monitor NICHT mehr angezeigt – sie liessen sich
            // sonst keinem konkreten Tag zuordnen und tauchten irrefuehrend
            // im Tagesueberblick auf.
            OR: [
              { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
              { startDate: { gte: dayStart, lte: dayEnd }, endDate: null },
              { startDate: null, endDate: { gte: dayStart } },
            ],
          },
        ],
      },
      select: {
        ...ticketSelect,
        accessArea: { select: { id: true, name: true } },
        subscription: { select: { id: true, name: true, requiresPhoto: true, requiresRfid: true } },
        service: {
          select: {
            id: true,
            name: true,
            requiresPhoto: true,
            requiresRfid: true,
            allowManualCheckin: true,
            // Pro Service mitnehmen, ob mindestens eine AccessArea einen ANNY-
            // Resource-Link hat. Damit kann das TicketCard ein "ANNY"-Badge
            // mit Sync-Status (annyBookingId vorhanden?) anzeigen.
            serviceAreas: {
              select: { area: { select: { _count: { select: { annyLinks: true } } } } },
            },
          },
        },
        verein: { select: { id: true, name: true } },
        _count: { select: { scans: true } },
      },
      orderBy: [{ slotStart: "asc" }, { startDate: "asc" }, { name: "asc" }],
    }),

    prisma.subscription.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        requiresPhoto: true,
        requiresRfid: true,
        defaultValidityType: true,
        defaultStartDate: true,
        defaultEndDate: true,
        defaultSlotStart: true,
        defaultSlotEnd: true,
        defaultValidityDurationMinutes: true,
        areas: { select: { id: true } },
        tickets: {
          where: {
            status: { in: ["VALID", "REDEEMED", "PAUSED"] },
            // Auch Abo-Tickets ohne jegliches Datum werden ausgeblendet,
            // damit der Shop-Monitor pro Tag konsistent ist.
            OR: [
              { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
              { startDate: { gte: dayStart, lte: dayEnd }, endDate: null },
              { startDate: null, endDate: { gte: dayStart } },
            ],
          },
          select: {
            ...ticketSelect,
            accessArea: { select: { id: true, name: true } },
            verein: { select: { id: true, name: true } },
            _count: { select: { scans: true } },
          },
        },
      },
    }),

    prisma.service.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        defaultValidityType: true,
        defaultStartDate: true,
        defaultEndDate: true,
        defaultSlotStart: true,
        defaultSlotEnd: true,
        defaultValidityDurationMinutes: true,
        mainAccessAreaId: true,
        // _count auf AnnyLinks der zugehoerigen AccessArea: wir wollen im
        // Shop-Frontend wissen, ob fuer einen Service ueberhaupt buchbare
        // ANNY-Slots existieren koennen. Wenn ja, zeigt der Add-Ticket-Dialog
        // die Slot-Auswahl - unabhaengig vom konfigurierten validityType.
        serviceAreas: {
          orderBy: { id: "asc" },
          select: {
            accessAreaId: true,
            area: { select: { _count: { select: { annyLinks: true } } } },
          },
        },
      },
    }),

    prisma.accessArea.findMany({
      where: { accountId },
      select: { id: true, name: true },
    }),

    prisma.scan.findMany({
      where: {
        accountId,
        scanTime: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true,
        code: true,
        result: true,
        scanTime: true,
        ticketId: true,
        device: { select: { id: true, name: true } },
      },
      orderBy: { scanTime: "desc" },
      take: 50,
    }),

    // ALLE Ticket-IDs, die heute mind. einen GRANTED-Scan hatten - ohne
    // 50er-Limit. Bisher wurde checkedIn aus den `recentScans` (limit 50)
    // abgeleitet - bei vollen Tagen (z.B. 200+ Scans) sind dann aeltere
    // Eincheck-Scans rausgefallen und das Ticket bekam wieder einen
    // "Einchecken"-Button, obwohl es am Drehkreuz bereits durch war.
    // distinct sorgt fuer eine Zeile pro Ticket, der Index
    // (accountId, scanTime, result) macht das effizient auch bei vielen
    // Scans pro Tag.
    prisma.scan.findMany({
      where: {
        accountId,
        scanTime: { gte: dayStart, lte: dayEnd },
        result: "GRANTED",
        ticketId: { not: null },
      },
      select: { ticketId: true },
      distinct: ["ticketId"],
    }),

    // Türen/Drehkreuze fuer den Quick-Open: ALLE des Accounts. Welche davon
    // als direkter Header-Button erscheinen, bestimmt MonitorConfig.deviceIds
    // (Tür-Schnellzugriff). Die uebrigen sind ueber das "Mehr Türen"-Menue
    // erreichbar.
    prisma.device.findMany({
      where: {
        accountId,
        category: { in: ["TUER", "DREHKREUZ"] },
      },
      select: { id: true, name: true, category: true, lastUpdate: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Offene Info-Anfragen: Tickets, die per Mail um Zusatzinfos gebeten
  // wurden, aber noch keine Antwort haben -> "Infos fehlen"-Badge im UI.
  // `ticketIds` ist eine JSON-Spalte, daher in JS aufloesen (Anzahl der
  // offenen Requests ist klein, das bleibt billig).
  const pendingInfoTicketIds = new Set<number>();
  try {
    const pendingRequests = await prisma.infoRequest.findMany({
      where: { accountId, status: "SENT" },
      select: { ticketIds: true },
    });
    for (const r of pendingRequests) {
      if (Array.isArray(r.ticketIds)) {
        for (const id of r.ticketIds as number[]) pendingInfoTicketIds.add(id);
      }
    }
  } catch { /* non-critical */ }

  const checkedInIds = new Set(
    grantedTicketIdsToday
      .map((s) => s.ticketId)
      .filter((id): id is number => id != null),
  );

  /** Abos & Vereinsmitglieder: Einchecken nur für den gewählten Tag (GRANTED-Scan an
   *  diesem Tag), nicht dauerhaft über REDEEMED. Vereinsmitglieder (vereinId) sind
   *  Jahres-Mitgliedschaften und werden wie Abos behandelt – sonst stuenden sie nach
   *  einem Check-in an jedem Tag als „eingecheckt“. */
  function checkedInForTicket(t: { id: number; status: string; subscriptionId: number | null; vereinId: number | null }) {
    if (t.subscriptionId != null || t.vereinId != null) {
      return checkedInIds.has(t.id);
    }
    return t.status === "REDEEMED" || checkedInIds.has(t.id);
  }

  const servicesWithAreas = services.map((s) => ({
    id: s.id,
    name: s.name,
    mainAccessAreaId: s.mainAccessAreaId,
    defaultValidityType: s.defaultValidityType,
    defaultStartDate: s.defaultStartDate,
    defaultEndDate: s.defaultEndDate,
    defaultSlotStart: s.defaultSlotStart,
    defaultSlotEnd: s.defaultSlotEnd,
    defaultValidityDurationMinutes: s.defaultValidityDurationMinutes,
    areaIds: s.serviceAreas.map((sa) => sa.accessAreaId),
    // true wenn mindestens eine AccessArea des Service einen AnnyResourceLink
    // hat -> Kursbuchung via ANNY-Slots moeglich.
    hasAnnyLink: s.serviceAreas.some((sa) => (sa.area?._count.annyLinks ?? 0) > 0),
  }));

  // Server-side `service.hasAnnyLink` auf den Tickets aufloesen. Das braucht
  // das TicketCard fuer das "ANNY"-Sync-Badge (zeigt orange wenn ANNY-Link
  // existiert aber `annyBookingId` fehlt -> Sync war nicht erfolgreich oder
  // Ticket wurde vor dem Sync-Feature angelegt).
  const annyLinkedServiceIds = new Set(
    servicesWithAreas.filter((s) => s.hasAnnyLink).map((s) => s.id),
  );

  const enrichedTickets = tickets.map((t) => ({
    ...t,
    checkedIn: checkedInForTicket(t),
    infoPending:
      pendingInfoTicketIds.has(t.id) &&
      (t.guestInfo == null || Object.keys(t.guestInfo as object).length === 0),
    service: t.service
      ? (() => {
          // serviceAreas raus - braucht das Frontend nicht und blaeht den
          // Payload pro Ticket auf.
          const { serviceAreas: _omit, ...serviceLite } = t.service;
          void _omit;
          return {
            ...serviceLite,
            hasAnnyLink: annyLinkedServiceIds.has(t.service.id),
          };
        })()
      : t.service,
  }));

  const subscriptions = allSubscriptions;
  const enrichedSubscriptions = subscriptions.map((sub) => ({
    ...sub,
    tickets: sub.tickets.map((t) => ({
      ...t,
      checkedIn: checkedInForTicket(t),
      infoPending:
        pendingInfoTicketIds.has(t.id) &&
        (t.guestInfo == null || Object.keys(t.guestInfo as object).length === 0),
    })),
  }));

  const subsWithAreas = allSubscriptions.map((s) => ({
    id: s.id,
    name: s.name,
    defaultValidityType: s.defaultValidityType,
    defaultStartDate: s.defaultStartDate,
    defaultEndDate: s.defaultEndDate,
    defaultSlotStart: s.defaultSlotStart,
    defaultSlotEnd: s.defaultSlotEnd,
    defaultValidityDurationMinutes: s.defaultValidityDurationMinutes,
    areaIds: s.areas.map((a) => a.id),
  }));

  let annySyncStatus: { lastSync: string | null; created?: number; updated?: number; errors?: number; errorDetails?: string[] } | null = null;
  try {
    const annyConfig = await prisma.apiConfig.findFirst({
      where: { accountId, provider: "ANNY" },
      select: { lastUpdate: true, extraConfig: true },
    });
    if (annyConfig) {
      const extra = annyConfig.extraConfig ? JSON.parse(annyConfig.extraConfig) : {};
      const sr = extra.lastSyncResult;
      annySyncStatus = {
        lastSync: sr?.at || annyConfig.lastUpdate?.toISOString() || null,
        created: sr?.created,
        updated: sr?.updated,
        errors: sr?.errors,
        errorDetails: sr?.errorDetails,
      };
    }
  } catch { /* non-critical */ }

  return NextResponse.json(
    {
      monitorName: monitor.name,
      accountName: monitor.account.name,
      date: berlinDate,
      tickets: enrichedTickets,
      subscriptions: enrichedSubscriptions,
      services: servicesWithAreas,
      areas,
      allSubscriptions: subsWithAreas,
      recentScans,
      annySyncStatus,
      openableDevices,
      // IDs der "Tür-Schnellzugriff"-Geraete (= MonitorConfig.deviceIds, sofern
      // gesetzt). Werden im Frontend als direkter Button im Header gerendert.
      quickDeviceIds: monitorDeviceIds.filter((id) =>
        openableDevices.some((d) => d.id === id),
      ),
    },
    {
      // Token-URL ist effektiv ein geteiltes Geheimnis; eine kurze Edge-
      // Cachezeit beschleunigt das Dauer-Polling im Checkin-Frontend ohne
      // dass eine Scan-Aenderung sichtbar verzoegert wird. Browser selbst
      // halten den Body nicht laenger als Sekunden, der CDN-Edge serviert
      // schnelle 5-Sekunden-Bursts. Aenderungen werden via SWR-Revalidate
      // im Hintergrund nachgezogen.
      headers: {
        "Cache-Control": "public, s-maxage=3, stale-while-revalidate=10",
      },
    },
  );
}
