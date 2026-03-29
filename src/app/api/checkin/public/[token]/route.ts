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
  } as const;

  const [tickets, subscriptions, services, areas, allSubscriptions, recentScans] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        accountId,
        status: { in: ["VALID", "REDEEMED", "PAUSED"] },
        AND: [
          { OR: [{ source: null }, { source: { notIn: ["EMP_CONTROL"] } }] },
          {
            OR: [
              { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
              { startDate: null, endDate: null, createdAt: { gte: dayStart, lte: dayEnd } },
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
        service: { select: { id: true, name: true, requiresPhoto: true, requiresRfid: true, allowManualCheckin: true } },
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
        tickets: {
          where: {
            status: { in: ["VALID", "REDEEMED", "PAUSED"] },
            OR: [
              { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
              { startDate: null, endDate: null, createdAt: { gte: dayStart, lte: dayEnd } },
              { startDate: { gte: dayStart, lte: dayEnd }, endDate: null },
              { startDate: null, endDate: { gte: dayStart } },
            ],
          },
          select: {
            ...ticketSelect,
            accessArea: { select: { id: true, name: true } },
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
        serviceAreas: { select: { accessAreaId: true } },
      },
    }),

    prisma.accessArea.findMany({
      where: { accountId },
      select: { id: true, name: true },
    }),

    prisma.subscription.findMany({
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
        areas: { select: { id: true } },
      },
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
  ]);

  const checkedInIds = new Set(
    recentScans
      .filter((s) => s.result === "GRANTED" && s.ticketId)
      .map((s) => s.ticketId!)
  );

  /** Abos: Einchecken nur für den gewählten Tag (GRANTED-Scan an diesem Tag), nicht dauerhaft über REDEEMED. */
  function checkedInForTicket(t: { id: number; status: string; subscriptionId: number | null }) {
    if (t.subscriptionId != null) {
      return checkedInIds.has(t.id);
    }
    return t.status === "REDEEMED" || checkedInIds.has(t.id);
  }

  const enrichedTickets = tickets.map((t) => ({
    ...t,
    checkedIn: checkedInForTicket(t),
  }));

  const enrichedSubscriptions = subscriptions.map((sub) => ({
    ...sub,
    tickets: sub.tickets.map((t) => ({
      ...t,
      checkedIn: checkedInForTicket(t),
    })),
  }));

  const servicesWithAreas = services.map((s) => ({
    id: s.id,
    name: s.name,
    defaultValidityType: s.defaultValidityType,
    defaultStartDate: s.defaultStartDate,
    defaultEndDate: s.defaultEndDate,
    defaultSlotStart: s.defaultSlotStart,
    defaultSlotEnd: s.defaultSlotEnd,
    defaultValidityDurationMinutes: s.defaultValidityDurationMinutes,
    areaIds: s.serviceAreas.map((sa) => sa.accessAreaId),
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

  return NextResponse.json({
    monitorName: monitor.name,
    accountName: monitor.account.name,
    date: berlinDate,
    tickets: enrichedTickets,
    subscriptions: enrichedSubscriptions,
    services: servicesWithAreas,
    areas,
    allSubscriptions: subsWithAreas,
    recentScans,
  });
}
