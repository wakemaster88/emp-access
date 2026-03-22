import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Scan zählt nur, wenn er im Gültigkeitsfenster des Abo-Tickets liegt. */
function scanInTicketValidity(scanTime: Date, start: Date | null, end: Date | null): boolean {
  if (start && scanTime < start) return false;
  if (end && scanTime > end) return false;
  return true;
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

  const ticketIds = tickets.map((t) => t.id);
  const scans =
    ticketIds.length === 0
      ? []
      : await db.scan.findMany({
          where: { ...whereAccount, ticketId: { in: ticketIds } },
          select: {
            id: true,
            ticketId: true,
            scanTime: true,
            result: true,
            device: { select: { name: true } },
          },
        });

  const ticketById = new Map(tickets.map((t) => [t.id, t]));

  const validScans = scans.filter((s) => {
    if (!s.ticketId) return false;
    const t = ticketById.get(s.ticketId);
    if (!t) return false;
    return scanInTicketValidity(new Date(s.scanTime), effectiveValidityStart(t), effectiveValidityEnd(t));
  });

  const grantedScans = validScans.filter((s) => s.result === "GRANTED");
  const deniedScans = validScans.filter((s) => s.result === "DENIED");

  const overview = subscriptions
    .map((sub) => {
      const subTickets = tickets.filter((t) => t.subscriptionId === sub.id);
      const subTicketIds = new Set(subTickets.map((t) => t.id));
      const subScans = validScans.filter((s) => s.ticketId && subTicketIds.has(s.ticketId));
      const granted = subScans.filter((s) => s.result === "GRANTED").length;
      const denied = subScans.filter((s) => s.result === "DENIED").length;
      const uniqueHoldersWithVisits = new Set(
        subScans.filter((s) => s.result === "GRANTED" && s.ticketId).map((s) => s.ticketId!),
      ).size;
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
  for (const s of validScans) {
    if (!s.ticketId) continue;
    const v = visitsByTicket.get(s.ticketId);
    if (!v) continue;
    if (s.result === "GRANTED") {
      v.granted++;
      const d = new Date(s.scanTime);
      if (!v.lastVisit || d > v.lastVisit) v.lastVisit = d;
    } else if (s.result === "DENIED") v.denied++;
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

  for (const s of validScans) {
    const key = localDateStr(new Date(s.scanTime));
    const b = timelineMap.get(key);
    if (!b) continue;
    if (s.result === "GRANTED") b.granted++;
    else if (s.result === "DENIED") b.denied++;
  }

  const timeline = [...timelineMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);

  const deviceMap = new Map<string, { granted: number; denied: number }>();
  for (const s of validScans) {
    const name = s.device?.name ?? "Web / unbekannt";
    const e = deviceMap.get(name) || { granted: 0, denied: 0 };
    if (s.result === "GRANTED") e.granted++;
    else if (s.result === "DENIED") e.denied++;
    deviceMap.set(name, e);
  }
  const byDevice = [...deviceMap.entries()]
    .map(([name, { granted, denied }]) => ({ name, granted, denied, total: granted + denied }))
    .sort((a, b) => b.total - a.total);

  const uniqueHolders = new Set(grantedScans.map((s) => s.ticketId).filter(Boolean)).size;
  const totalVisits = grantedScans.length;
  const avgVisits = uniqueHolders > 0 ? Math.round((totalVisits / uniqueHolders) * 10) / 10 : 0;
  const grantRate = validScans.length > 0 ? Math.round((grantedScans.length / validScans.length) * 100) : 0;

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
  for (const s of grantedScans) {
    weekdayCounts[new Date(s.scanTime).getDay()]++;
  }
  const weekdayLabels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const byWeekday = weekdayLabels.map((label, i) => ({ label, visits: weekdayCounts[i] }));

  const summary = {
    totalTickets: tickets.length,
    activeTickets: tickets.filter((t) => t.status === "VALID" || t.status === "PAUSED").length,
    totalVisits,
    deniedCount: deniedScans.length,
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
