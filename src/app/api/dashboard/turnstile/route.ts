import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { addCalendarDays, berlinDayRange, berlinYmd, isBerlinYmd } from "@/lib/berlin-day";
import { summarizeTurnstileDay } from "@/lib/turnstile-stats";

/**
 * Bereich, der ohne explizite Auswahl ausgewertet wird. Das Drehkreuz an der
 * Seilbahn A ist der aussagekraeftigste Zaehlpunkt (jede Fahrt einzeln).
 * Kein Treffer -> Bereich mit den meisten Drehkreuzen.
 */
const PREFERRED_AREA_NAME = /seilbahn a/i;

/** Wie das Dashboard: Heartbeat der letzten 5 Minuten = online. */
const ONLINE_WINDOW_MS = 5 * 60_000;

type Direction = "IN" | "OUT" | "BOTH";

function direction(accessIn: number | null, accessOut: number | null, areaId: number): Direction {
  if (accessIn === areaId && accessOut === areaId) return "BOTH";
  return accessIn === areaId ? "IN" : "OUT";
}

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId, isSuperAdmin } = session;
  const where = isSuperAdmin ? {} : { accountId: accountId! };

  const dateParam = request.nextUrl.searchParams.get("date");
  if (dateParam && !isBerlinYmd(dateParam)) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }
  const dateStr = dateParam ?? berlinYmd(new Date());

  const areaParam = request.nextUrl.searchParams.get("areaId");
  const requestedAreaId = areaParam ? Number(areaParam) : null;
  if (areaParam && !Number.isInteger(requestedAreaId)) {
    return NextResponse.json({ error: "Ungültiger Bereich" }, { status: 400 });
  }

  const turnstiles = await db.device.findMany({
    where: {
      ...where,
      category: "DREHKREUZ",
      OR: [{ accessIn: { not: null } }, { accessOut: { not: null } }],
    },
    select: { id: true, name: true, accessIn: true, accessOut: true, isActive: true, lastUpdate: true },
    orderBy: { name: "asc" },
  });

  const areaIds = [
    ...new Set(turnstiles.flatMap((d) => [d.accessIn, d.accessOut].filter((id): id is number => id != null))),
  ];
  const areaRows = areaIds.length
    ? await db.accessArea.findMany({
        where: { ...where, id: { in: areaIds } },
        select: { id: true, name: true, personLimit: true },
      })
    : [];

  const areas = areaRows
    .map((area) => ({
      id: area.id,
      name: area.name,
      personLimit: area.personLimit,
      devices: turnstiles.filter((d) => d.accessIn === area.id || d.accessOut === area.id),
    }))
    .filter((area) => area.devices.length > 0)
    .sort((a, b) => b.devices.length - a.devices.length || a.name.localeCompare(b.name, "de"));

  const areaOptions = areas.map((a) => ({ id: a.id, name: a.name, deviceCount: a.devices.length }));

  const area =
    areas.find((a) => a.id === requestedAreaId) ??
    areas.find((a) => PREFERRED_AREA_NAME.test(a.name)) ??
    areas[0];

  if (!area) {
    return NextResponse.json({ date: dateStr, areas: [], area: null });
  }

  const { start: dayStart, endExclusive } = berlinDayRange(dateStr);
  const weekStart = berlinDayRange(addCalendarDays(dateStr, -6)).start;
  const deviceIds = area.devices.map((d) => d.id);

  const [dayScans, weekScans, soldTickets] = await Promise.all([
    db.scan.findMany({
      where: { ...where, deviceId: { in: deviceIds }, scanTime: { gte: dayStart, lt: endExclusive } },
      select: {
        result: true,
        note: true,
        scanTime: true,
        deviceId: true,
        ticketId: true,
        ticket: {
          select: {
            ticketTypeName: true,
            service: { select: { name: true } },
            subscription: { select: { name: true } },
          },
        },
      },
      orderBy: { scanTime: "asc" },
    }),
    db.scan.findMany({
      where: { ...where, deviceId: { in: deviceIds }, scanTime: { gte: weekStart, lt: endExclusive } },
      select: { result: true, scanTime: true, ticketId: true },
    }),
    db.ticket.count({
      where: {
        ...where,
        createdAt: { gte: dayStart, lt: endExclusive },
        OR: [{ accessAreaId: area.id }, { service: { mainAccessAreaId: area.id } }],
      },
    }),
  ]);

  const summary = summarizeTurnstileDay({
    dateStr,
    dayScans: dayScans.map((scan) => ({
      result: scan.result,
      note: scan.note,
      scanTime: scan.scanTime,
      deviceId: scan.deviceId,
      ticketId: scan.ticketId,
      ticketTypeName:
        scan.ticket?.ticketTypeName ||
        scan.ticket?.service?.name ||
        scan.ticket?.subscription?.name ||
        null,
    })),
    weekScans,
    soldTickets,
    deviceIds,
  });

  const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS);

  return NextResponse.json({
    date: dateStr,
    areas: areaOptions,
    area: { id: area.id, name: area.name, personLimit: area.personLimit },
    totals: summary.totals,
    average: summary.average,
    previousDay: summary.previousDay,
    devices: area.devices.map((d) => {
      const stats = summary.deviceStats.get(d.id)!;
      return {
        id: d.id,
        name: d.name,
        direction: direction(d.accessIn, d.accessOut, area.id),
        isActive: d.isActive,
        online: !!d.lastUpdate && d.lastUpdate >= onlineSince,
        rides: stats.granted,
        denied: stats.denied,
        total: stats.total,
        lastScanAt: stats.lastScanAt,
      };
    }),
    hourly: summary.hourly,
    ticketTypes: summary.ticketTypes,
    denyReasons: summary.denyReasons,
    weekTrend: summary.weekTrend,
  });
}
