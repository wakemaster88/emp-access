import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { deviceCountsByName, loadAboScanCounts } from "@/lib/dashboard-counts";

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function displayName(t: { name: string; firstName: string | null; lastName: string | null }): string {
  const n = [t.firstName, t.lastName].filter(Boolean).join(" ").trim();
  if (n) return n;
  return t.name;
}

function effectiveValidityStart(t: {
  startDate: Date | null;
  subscription: { defaultStartDate: Date | null } | null;
}): Date | null {
  return t.startDate ?? t.subscription?.defaultStartDate ?? null;
}

function effectiveValidityEnd(t: {
  endDate: Date | null;
  subscription: { defaultEndDate: Date | null } | null;
}): Date | null {
  return t.endDate ?? t.subscription?.defaultEndDate ?? null;
}

const MAX_TIMELINE_DAYS = 400;

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId, isSuperAdmin } = session;
  const whereAccount = isSuperAdmin ? {} : { accountId: accountId! };

  const subscriptionIdParam = request.nextUrl.searchParams.get("subscriptionId");
  const subscriptionId = subscriptionIdParam ? parseInt(subscriptionIdParam, 10) : null;
  if (subscriptionIdParam && Number.isNaN(subscriptionId)) {
    return NextResponse.json({ error: "Ungültige subscriptionId" }, { status: 400 });
  }

  const subscriptions = await db.subscription.findMany({
    where: whereAccount,
    select: { id: true, name: true, defaultStartDate: true, defaultEndDate: true },
    orderBy: { name: "asc" },
  });

  const ticketWhere = {
    ...whereAccount,
    subscriptionId: { not: null } as const,
    ...(subscriptionId != null ? { subscriptionId } : {}),
  };

  const tickets = await db.ticket.findMany({
    where: ticketWhere,
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      startDate: true,
      endDate: true,
      status: true,
      subscriptionId: true,
      createdAt: true,
      subscription: { select: { id: true, name: true, defaultStartDate: true, defaultEndDate: true } },
    },
  });

  let scanTimeRange: { gte?: Date; lte?: Date } | undefined;
  if (tickets.length > 0) {
    const starts = tickets.map(t => effectiveValidityStart(t)).filter(Boolean) as Date[];
    const ends = tickets.map(t => effectiveValidityEnd(t)).filter(Boolean) as Date[];
    if (starts.length > 0) scanTimeRange = { ...scanTimeRange, gte: new Date(Math.min(...starts.map(d => d.getTime()))) };
    if (ends.length > 0) {
      const maxEnd = new Date(Math.max(...ends.map(d => d.getTime())));
      maxEnd.setUTCHours(23, 59, 59, 999);
      scanTimeRange = { ...scanTimeRange, lte: maxEnd };
    }
  }

  // Scans im Gültigkeitsfenster ihres Abo-Tickets, in der Datenbank gezählt:
  // je Ticket, je UTC-Stunde (Tag und Wochentag in Ortszeit wie bisher) und je Gerät.
  const scanCounts =
    tickets.length === 0
      ? { tickets: [], hours: [], devices: [] }
      : await loadAboScanCounts(
          db,
          isSuperAdmin ? null : accountId!,
          subscriptionId,
          scanTimeRange?.gte ?? null,
          scanTimeRange?.lte ?? null,
        );
  const countsByTicket = new Map(scanCounts.tickets.map((c) => [c.ticketId, c]));
  const sumHours = (result: string | null) =>
    scanCounts.hours.reduce((sum, h) => (result == null || h.result === result ? sum + h.count : sum), 0);
  const validScanCount = sumHours(null);
  const grantedScanCount = sumHours("GRANTED");
  const deniedScanCount = sumHours("DENIED");

  const overview = subscriptions
    .map((sub) => {
      const subTickets = tickets.filter((t) => t.subscriptionId === sub.id);
      let granted = 0;
      let denied = 0;
      let uniqueHoldersWithVisits = 0;
      for (const t of subTickets) {
        const c = countsByTicket.get(t.id);
        if (!c) continue;
        granted += c.granted;
        denied += c.denied;
        if (c.granted > 0) uniqueHoldersWithVisits++;
      }
      return {
        id: sub.id,
        name: sub.name,
        ticketCount: subTickets.length,
        activeTickets: subTickets.filter((t) => t.status === "VALID" || t.status === "PAUSED").length,
        grantedScans: granted,
        deniedScans: denied,
        uniqueHoldersWithVisits,
      };
    })
    .filter((o) => o.ticketCount > 0);

  const visitsByTicket = new Map<number, { granted: number; denied: number; lastVisit: Date | null }>();
  for (const t of tickets) {
    visitsByTicket.set(t.id, { granted: 0, denied: 0, lastVisit: null });
  }
  for (const c of scanCounts.tickets) {
    const v = visitsByTicket.get(c.ticketId);
    if (!v) continue;
    v.granted = c.granted;
    v.denied = c.denied;
    v.lastVisit = c.lastGranted ? new Date(c.lastGranted) : null;
  }

  const ticketBreakdown = tickets
    .map((t) => {
      const v = visitsByTicket.get(t.id)!;
      return {
        id: t.id,
        displayName: displayName(t),
        validFrom: t.startDate ?? t.subscription?.defaultStartDate ?? null,
        validTo: t.endDate ?? t.subscription?.defaultEndDate ?? null,
        status: t.status,
        grantedVisits: v.granted,
        deniedScans: v.denied,
        lastVisit: v.lastVisit?.toISOString() ?? null,
      };
    })
    .sort((a, b) => b.grantedVisits - a.grantedVisits || a.displayName.localeCompare(b.displayName, "de"));

  const now = new Date();
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;
  for (const t of tickets) {
    const vs = effectiveValidityStart(t);
    const ve = effectiveValidityEnd(t);
    if (vs && (!rangeStart || vs < rangeStart)) rangeStart = vs;
    if (ve && (!rangeEnd || ve > rangeEnd)) rangeEnd = ve;
  }
  if (!rangeStart) {
    rangeStart =
      tickets.length > 0
        ? new Date(Math.min(...tickets.map((t) => new Date(t.createdAt).getTime())))
        : new Date(now.getTime() - 90 * 86400000);
  }
  if (!rangeEnd) rangeEnd = now;
  if (rangeEnd > now) rangeEnd = now;
  if (rangeStart > rangeEnd) {
    rangeStart = new Date(rangeEnd.getTime() - 90 * 86400000);
  }

  let timelineStart = new Date(rangeStart);
  timelineStart.setHours(0, 0, 0, 0);
  const endDay = new Date(rangeEnd);
  endDay.setHours(23, 59, 59, 999);

  const dayMs = 86400000;
  const spanDays = Math.ceil((endDay.getTime() - timelineStart.getTime()) / dayMs) + 1;
  if (spanDays > MAX_TIMELINE_DAYS) {
    timelineStart = new Date(endDay.getTime() - (MAX_TIMELINE_DAYS - 1) * dayMs);
    timelineStart.setHours(0, 0, 0, 0);
  }

  const timelineMap = new Map<string, { label: string; granted: number; denied: number }>();
  const cursor = new Date(timelineStart);
  const daysDe = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  while (cursor <= endDay) {
    const key = localDateStr(cursor);
    timelineMap.set(key, {
      label: `${daysDe[cursor.getDay()]} ${cursor.getDate()}.${cursor.getMonth() + 1}`,
      granted: 0,
      denied: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const h of scanCounts.hours) {
    const key = localDateStr(new Date(h.hour));
    const b = timelineMap.get(key);
    if (!b) continue;
    if (h.result === "GRANTED") b.granted += h.count;
    else if (h.result === "DENIED") b.denied += h.count;
  }

  const timeline = [...timelineMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);

  const deviceIds = [...new Set(scanCounts.devices.map(s => s.deviceId).filter(Boolean))] as number[];
  const deviceLookup = deviceIds.length > 0
    ? new Map((await db.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } })).map(d => [d.id, d.name]))
    : new Map<number, string>();
  // Bei gleicher Summe zuerst das Gerät mit dem früheren ersten Scan.
  const byDevice = deviceCountsByName(
    scanCounts.devices,
    (deviceId) => (deviceId ? deviceLookup.get(deviceId) : null) ?? "Web / unbekannt",
  );

  const uniqueHolders = scanCounts.tickets.filter((c) => c.granted > 0).length;
  const totalVisits = grantedScanCount;
  const avgVisits = uniqueHolders > 0 ? Math.round((totalVisits / uniqueHolders) * 10) / 10 : 0;
  const grantRate = validScanCount > 0 ? Math.round((grantedScanCount / validScanCount) * 100) : 0;

  let busiestDay: string | null = null;
  let busiestDayCount = 0;
  for (const [k, v] of timelineMap) {
    const c = v.granted + v.denied;
    if (c > busiestDayCount) {
      busiestDayCount = c;
      busiestDay = k;
    }
  }
  if (busiestDayCount === 0) busiestDay = null;

  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const h of scanCounts.hours) {
    if (h.result === "GRANTED") weekdayCounts[new Date(h.hour).getDay()] += h.count;
  }
  const weekdayLabels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const byWeekday = weekdayLabels.map((label, i) => ({ label, visits: weekdayCounts[i] }));

  const summary = {
    totalTickets: tickets.length,
    activeTickets: tickets.filter((t) => t.status === "VALID" || t.status === "PAUSED").length,
    totalVisits,
    deniedCount: deniedScanCount,
    uniqueHoldersWithVisits: uniqueHolders,
    avgVisitsPerHolder: avgVisits,
    grantRate,
    busiestDay,
    busiestDayCount,
  };

  const selectedSub =
    subscriptionId != null ? subscriptions.find((s) => s.id === subscriptionId) ?? null : null;

  return NextResponse.json({
    subscriptions: subscriptions.map((s) => ({ id: s.id, name: s.name })),
    selectedSubscriptionId: subscriptionId,
    selectedSubscription: selectedSub ? { id: selectedSub.id, name: selectedSub.name } : null,
    overview: subscriptionId == null ? overview : undefined,
    rangeStart: localDateStr(rangeStart),
    rangeEnd: localDateStr(rangeEnd),
    summary,
    tickets: subscriptionId != null ? ticketBreakdown : [],
    timeline: subscriptionId != null ? timeline : [],
    byDevice: subscriptionId != null ? byDevice : [],
    byWeekday,
  });
}
