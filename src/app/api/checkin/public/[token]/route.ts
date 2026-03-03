import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  const dayStart = new Date(`${berlinDate}T00:00:00+01:00`);
  const dayEnd = new Date(`${berlinDate}T23:59:59+01:00`);

  const ticketSelect = {
    id: true,
    name: true,
    firstName: true,
    lastName: true,
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

  const [tickets, subscriptions, services, areas, recentScans] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        accountId,
        status: { in: ["VALID", "REDEEMED"] },
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
            status: { in: ["VALID", "REDEEMED"] },
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
      select: { id: true, name: true },
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
  ]);

  const checkedInIds = new Set(
    recentScans
      .filter((s) => s.result === "GRANTED" && s.ticketId)
      .map((s) => s.ticketId!)
  );

  const enrichedTickets = tickets.map((t) => ({
    ...t,
    checkedIn: t.status === "REDEEMED" || checkedInIds.has(t.id),
  }));

  return NextResponse.json({
    monitorName: monitor.name,
    accountName: monitor.account.name,
    date: berlinDate,
    tickets: enrichedTickets,
    subscriptions,
    services,
    areas,
    recentScans,
  });
}
