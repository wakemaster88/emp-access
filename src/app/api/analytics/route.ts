import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const r = new Date(d);
  r.setDate(diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId, isSuperAdmin } = session;
  const where = isSuperAdmin ? {} : { accountId: accountId! };

  const params = request.nextUrl.searchParams;
  const mode = params.get("mode") || "week";
  const refDate = params.get("date") ? new Date(params.get("date")! + "T12:00:00") : new Date();

  let rangeStart: Date;
  let rangeEnd: Date;
  let bucketFormat: "hour" | "day" | "week" | "month";

  switch (mode) {
    case "day": {
      rangeStart = new Date(refDate);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(refDate);
      rangeEnd.setHours(23, 59, 59, 999);
      bucketFormat = "hour";
      break;
    }
    case "week": {
      rangeStart = startOfWeek(refDate);
      rangeEnd = addDays(rangeStart, 6);
      rangeEnd.setHours(23, 59, 59, 999);
      bucketFormat = "day";
      break;
    }
    case "month": {
      rangeStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
      rangeEnd = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);
      bucketFormat = "day";
      break;
    }
    case "year": {
      rangeStart = new Date(refDate.getFullYear(), 0, 1);
      rangeEnd = new Date(refDate.getFullYear(), 11, 31, 23, 59, 59, 999);
      bucketFormat = "month";
      break;
    }
    case "custom": {
      const from = params.get("from");
      const to = params.get("to");
      if (!from || !to) return NextResponse.json({ error: "from/to erforderlich" }, { status: 400 });
      rangeStart = new Date(from + "T00:00:00");
      rangeEnd = new Date(to + "T23:59:59.999");
      const diffDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24));
      bucketFormat = diffDays <= 1 ? "hour" : diffDays <= 62 ? "day" : diffDays <= 365 ? "week" : "month";
      break;
    }
    default:
      return NextResponse.json({ error: "Ungültiger Modus" }, { status: 400 });
  }

  const [scans, tickets, areas, devices] = await Promise.all([
    db.scan.findMany({
      where: { ...where, scanTime: { gte: rangeStart, lte: rangeEnd } },
      select: {
        id: true,
        scanTime: true,
        result: true,
        deviceId: true,
        ticketId: true,
        device: { select: { name: true } },
      },
      orderBy: { scanTime: "asc" },
    }),
    db.ticket.findMany({
      where: {
        ...where,
        OR: [
          { startDate: null, endDate: null },
          { startDate: { lte: rangeEnd }, endDate: null },
          { startDate: null, endDate: { gte: rangeStart } },
          { startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } },
        ],
      },
      select: {
        id: true,
        status: true,
        source: true,
        accessAreaId: true,
        subscriptionId: true,
        serviceId: true,
        startDate: true,
        createdAt: true,
        accessArea: { select: { name: true } },
        subscription: { select: { name: true } },
        service: { select: { name: true } },
      },
    }),
    db.accessArea.findMany({
      where: { ...where, showOnDashboard: true },
      select: { id: true, name: true, personLimit: true },
      orderBy: { name: "asc" },
    }),
    db.device.findMany({
      where: isSuperAdmin ? {} : { accountId: accountId! },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // --- Summary ---
  const totalScans = scans.length;
  const grantedScans = scans.filter((s) => s.result === "GRANTED").length;
  const deniedScans = scans.filter((s) => s.result === "DENIED").length;
  const uniqueTicketsScanned = new Set(scans.filter((s) => s.ticketId).map((s) => s.ticketId)).size;
  const totalTickets = tickets.length;
  const validTickets = tickets.filter((t) => t.status === "VALID").length;
  const redeemedTickets = tickets.filter((t) => t.status === "REDEEMED").length;
  const annyTickets = tickets.filter((t) => t.source === "ANNY").length;

  // --- Scans over time ---
  function bucketKey(d: Date): string {
    switch (bucketFormat) {
      case "hour": return `${String(d.getHours()).padStart(2, "0")}:00`;
      case "day": return localDateStr(d);
      case "week": {
        const ws = startOfWeek(d);
        return `KW ${localDateStr(ws)}`;
      }
      case "month": {
        const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
        return months[d.getMonth()];
      }
    }
  }

  function bucketLabel(d: Date): string {
    switch (bucketFormat) {
      case "hour": return `${String(d.getHours()).padStart(2, "0")}:00`;
      case "day": {
        const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
        return `${days[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`;
      }
      case "week": {
        const ws = startOfWeek(d);
        return `${ws.getDate()}.${ws.getMonth() + 1}`;
      }
      case "month": {
        const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
        return months[d.getMonth()];
      }
    }
  }

  const timelineMap = new Map<string, { label: string; granted: number; denied: number; total: number }>();

  // Pre-fill all buckets
  if (bucketFormat === "hour") {
    for (let h = 0; h < 24; h++) {
      const key = `${String(h).padStart(2, "0")}:00`;
      timelineMap.set(key, { label: key, granted: 0, denied: 0, total: 0 });
    }
  } else if (bucketFormat === "day") {
    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      const key = bucketKey(cursor);
      timelineMap.set(key, { label: bucketLabel(cursor), granted: 0, denied: 0, total: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (bucketFormat === "month") {
    for (let m = 0; m < 12; m++) {
      const d = new Date(refDate.getFullYear(), m, 1);
      const key = bucketKey(d);
      timelineMap.set(key, { label: bucketLabel(d), granted: 0, denied: 0, total: 0 });
    }
  }

  for (const scan of scans) {
    const d = new Date(scan.scanTime);
    const key = bucketKey(d);
    const bucket = timelineMap.get(key) || { label: bucketLabel(d), granted: 0, denied: 0, total: 0 };
    bucket.total++;
    if (scan.result === "GRANTED") bucket.granted++;
    else if (scan.result === "DENIED") bucket.denied++;
    timelineMap.set(key, bucket);
  }

  const timeline = [...timelineMap.values()];

  // --- Scans by area ---
  const ticketAreaMap = new Map<number, string>();
  for (const t of tickets) {
    if (t.accessArea) ticketAreaMap.set(t.id, t.accessArea.name);
  }
  const areaScanCounts = new Map<string, number>();
  for (const scan of scans) {
    if (scan.ticketId && ticketAreaMap.has(scan.ticketId)) {
      const name = ticketAreaMap.get(scan.ticketId)!;
      areaScanCounts.set(name, (areaScanCounts.get(name) || 0) + 1);
    }
  }
  const byArea = [...areaScanCounts.entries()]
    .map(([name, scans]) => ({ name, scans }))
    .sort((a, b) => b.scans - a.scans);

  // --- Scans by device ---
  const deviceScanCounts = new Map<string, { granted: number; denied: number }>();
  for (const scan of scans) {
    const name = scan.device.name;
    const entry = deviceScanCounts.get(name) || { granted: 0, denied: 0 };
    if (scan.result === "GRANTED") entry.granted++;
    else if (scan.result === "DENIED") entry.denied++;
    deviceScanCounts.set(name, entry);
  }
  const byDevice = [...deviceScanCounts.entries()]
    .map(([name, { granted, denied }]) => ({ name, granted, denied, total: granted + denied }))
    .sort((a, b) => b.total - a.total);

  // --- Tickets by type (Service/Abo/Resource) ---
  const typeCounts = new Map<string, number>();
  for (const t of tickets) {
    const typeName = t.service?.name || t.subscription?.name || t.accessArea?.name || "Sonstige";
    typeCounts.set(typeName, (typeCounts.get(typeName) || 0) + 1);
  }
  const byType = [...typeCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // --- Peak hours ---
  const hourCounts = new Array(24).fill(0);
  for (const scan of scans) {
    hourCounts[new Date(scan.scanTime).getHours()]++;
  }
  const peakHours = hourCounts.map((count, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    count,
  }));

  return NextResponse.json({
    mode,
    rangeStart: localDateStr(rangeStart),
    rangeEnd: localDateStr(rangeEnd),
    summary: {
      totalScans,
      grantedScans,
      deniedScans,
      grantRate: totalScans > 0 ? Math.round((grantedScans / totalScans) * 100) : 0,
      uniqueTicketsScanned,
      totalTickets,
      validTickets,
      redeemedTickets,
      annyTickets,
    },
    timeline,
    byArea,
    byDevice,
    byType,
    peakHours,
    areas: areas.map((a) => ({ id: a.id, name: a.name, personLimit: a.personLimit })),
    devices: devices.map((d) => ({ id: d.id, name: d.name })),
  });
}
