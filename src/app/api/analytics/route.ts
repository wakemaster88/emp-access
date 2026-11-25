import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { deviceCountsByName, loadAnalyticsCounts } from "@/lib/dashboard-counts";

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

  // Scans und Tickets des Zeitraums in der Datenbank zaehlen. Scans je
  // UTC-Stunde: Tag, Woche, Monat und Stunde der Anzeige ergeben sich daraus
  // wie bisher aus der Ortszeit der Function (Zonen mit ganzen Stunden Versatz).
  const [counts, areas, devices] = await Promise.all([
    loadAnalyticsCounts(db, isSuperAdmin ? null : accountId!, rangeStart, rangeEnd),
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
  const sumHours = (pred: (result: string) => boolean) =>
    counts.hours.reduce((sum, h) => (pred(h.result) ? sum + h.count : sum), 0);
  const sumTickets = (pred: (t: (typeof counts.tickets)[number]) => boolean) =>
    counts.tickets.reduce((sum, t) => (pred(t) ? sum + t.count : sum), 0);
  const totalScans = sumHours(() => true);
  const grantedScans = sumHours((r) => r === "GRANTED");
  const deniedScans = sumHours((r) => r === "DENIED");
  const uniqueTicketsScanned = counts.uniqueTickets;
  const totalTickets = sumTickets(() => true);
  const validTickets = sumTickets((t) => t.status === "VALID");
  const redeemedTickets = sumTickets((t) => t.status === "REDEEMED");
  const annyTickets = sumTickets((t) => t.source === "ANNY");

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

  // Stunden kommen aufsteigend sortiert: neue Schluessel entstehen in derselben
  // Reihenfolge wie frueher beim Durchlauf der Scans.
  for (const h of counts.hours) {
    const d = new Date(h.hour);
    const key = bucketKey(d);
    const bucket = timelineMap.get(key) || { label: bucketLabel(d), granted: 0, denied: 0, total: 0 };
    bucket.total += h.count;
    if (h.result === "GRANTED") bucket.granted += h.count;
    else if (h.result === "DENIED") bucket.denied += h.count;
    timelineMap.set(key, bucket);
  }

  const timeline = [...timelineMap.values()];

  // --- Scans by area ---
  // Bei gleicher Zahl zuerst der Bereich mit dem frueheren ersten Scan.
  const byArea = [...counts.areas]
    .sort((a, b) => a.firstAt.getTime() - b.firstAt.getTime())
    .map((a) => ({ name: a.name, scans: a.count }))
    .sort((a, b) => b.scans - a.scans);

  // --- Scans by device ---
  const deviceNameMap = new Map(devices.map(d => [d.id, d.name]));
  const byDevice = deviceCountsByName(
    counts.devices,
    (deviceId) => (deviceId ? deviceNameMap.get(deviceId) : null) ?? "Web-Scanner",
  );

  // --- Tickets by type (Service/Abo/Resource) ---
  // Bei gleicher Zahl zuerst der Typ mit der kleinsten Ticket-ID.
  const typeCounts = new Map<string, { count: number; firstId: number }>();
  for (const t of counts.tickets) {
    const typeName = t.serviceName || t.subscriptionName || t.areaName || "Sonstige";
    const e = typeCounts.get(typeName) ?? { count: 0, firstId: t.firstId };
    e.count += t.count;
    if (t.firstId < e.firstId) e.firstId = t.firstId;
    typeCounts.set(typeName, e);
  }
  const byType = [...typeCounts.entries()]
    .sort((a, b) => a[1].firstId - b[1].firstId)
    .map(([name, { count }]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // --- Peak hours ---
  const hourCounts = new Array(24).fill(0);
  for (const h of counts.hours) {
    hourCounts[new Date(h.hour).getHours()] += h.count;
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
