import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { addCalendarDays, berlinDayRange, berlinYmd, isBerlinYmd } from "@/lib/berlin-day";
import { summarizeAreasDay } from "@/lib/dashboard-areas";
import { loadAreaWeekCounts } from "@/lib/dashboard-counts";

export const dynamic = "force-dynamic";

/**
 * Tagesauswertung des Dashboards: je Drehkreuz-Bereich Eintritte bzw.
 * Fahrten, Gäste, Stundenverlauf, sieben Tage, Ticket-Typen, Leser und
 * Ablehnungsgründe – alle Bereiche in einer Antwort, damit das Umschalten
 * zwischen Bereichen ohne neuen Abruf geht. Ersetzt `/api/dashboard/turnstile`
 * (ein Bereich je Abruf) und die Mischstatistik aus `/api/dashboard`.
 */
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

  const devices = await db.device.findMany({
    where: {
      ...where,
      category: "DREHKREUZ",
      OR: [{ accessIn: { not: null } }, { accessOut: { not: null } }],
    },
    select: { id: true, name: true, accessIn: true, accessOut: true, countsAsStart: true, lastUpdate: true },
    orderBy: { name: "asc" },
  });

  const areaIds = [
    ...new Set(devices.flatMap((d) => [d.accessIn, d.accessOut].filter((id): id is number => id != null))),
  ];
  if (areaIds.length === 0) {
    return NextResponse.json({ date: dateStr, areas: [] });
  }

  const deviceIds = devices.map((d) => d.id);
  const { start: dayStart, endExclusive } = berlinDayRange(dateStr);
  const weekStart = berlinDayRange(addCalendarDays(dateStr, -6)).start;

  // Sieben-Tage-Verlauf je Bereich in der Datenbank zaehlen (nur Eingangsgeraete,
  // wie in `summarizeAreasDay`), statt eine Woche Scans als Zeilen zu laden.
  const weekAccountId = isSuperAdmin ? null : accountId!;
  const weekCountsPromise = Promise.all(
    areaIds.map(async (areaId) => {
      const entryIds = devices.filter((d) => d.accessIn === areaId).map((d) => d.id);
      const counts = await loadAreaWeekCounts(db, weekAccountId, entryIds, weekStart, endExclusive);
      return [areaId, counts] as const;
    }),
  );

  const [areas, dayScans, weekCounts, soldTickets] = await Promise.all([
    db.accessArea.findMany({
      where: { ...where, id: { in: areaIds } },
      select: { id: true, name: true, personLimit: true },
    }),
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
    weekCountsPromise,
    db.ticket.findMany({
      where: {
        ...where,
        createdAt: { gte: dayStart, lt: endExclusive },
        OR: [{ accessAreaId: { in: areaIds } }, { service: { mainAccessAreaId: { in: areaIds } } }],
      },
      select: { accessAreaId: true, service: { select: { mainAccessAreaId: true } } },
    }),
  ]);

  const sold = new Map<number, number>();
  for (const t of soldTickets) {
    const id = t.accessAreaId ?? t.service?.mainAccessAreaId;
    if (id != null) sold.set(id, (sold.get(id) ?? 0) + 1);
  }

  const summaries = summarizeAreasDay({
    dateStr,
    now: new Date(),
    areas,
    devices,
    dayScans: dayScans.map((s) => ({
      result: s.result,
      note: s.note,
      scanTime: s.scanTime,
      deviceId: s.deviceId,
      ticketId: s.ticketId,
      ticketTypeName: s.ticket?.ticketTypeName || s.ticket?.service?.name || s.ticket?.subscription?.name || null,
    })),
    weekScans: [],
    weekCountsByArea: new Map(weekCounts),
    sold,
  });

  return NextResponse.json({ date: dateStr, areas: summaries });
}
