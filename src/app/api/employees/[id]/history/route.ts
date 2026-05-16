import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import type { Prisma, ScanResult } from "@prisma/client";

/**
 * Verlauf (Scan-History) eines Mitarbeiters.
 *
 * Query-Parameter:
 *   - days (default 30, max 365)
 *   - result (GRANTED | DENIED | PROTECTED | "all")
 *   - source (mobile | rfid | dashboard | "all") - leitet sich aus dem `code`-Prefix ab
 *   - limit (default 200, max 1000)
 *
 * Antwort: { scans, stats, devices }
 *   - scans: chronologisch absteigend
 *   - stats: gesamt, granted, denied, byDay (letzte 14 Tage)
 *   - devices: Top-Geraete nach Anzahl Granted-Scans
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const employeeId = Number(id);
  if (Number.isNaN(employeeId)) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const ticket = await db.ticket.findFirst({
    where: { id: employeeId, accountId: accountId!, source: "EMP_CONTROL" },
    select: { id: true },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Mitarbeiter nicht gefunden" }, { status: 404 });
  }

  const url = request.nextUrl;
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || "30"), 1), 365);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "200"), 1), 1000);
  const resultParam = (url.searchParams.get("result") || "all").toUpperCase();
  const sourceParam = (url.searchParams.get("source") || "all").toLowerCase();

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: Prisma.ScanWhereInput = {
    accountId: accountId!,
    ticketId: employeeId,
    scanTime: { gte: since },
  };

  if (resultParam === "GRANTED" || resultParam === "DENIED" || resultParam === "PROTECTED") {
    where.result = resultParam as ScanResult;
  }

  if (sourceParam === "mobile") {
    where.code = { startsWith: "mobile:" };
  } else if (sourceParam === "dashboard") {
    where.code = { equals: "Dashboard-Öffnung" };
  } else if (sourceParam === "rfid") {
    where.AND = [
      { code: { not: { startsWith: "mobile:" } } },
      { code: { not: "Dashboard-Öffnung" } },
    ];
  }

  const [scans, totalsRaw, byDayRaw, topDevicesRaw] = await Promise.all([
    db.scan.findMany({
      where,
      include: {
        device: { select: { id: true, name: true, type: true, category: true } },
      },
      orderBy: { scanTime: "desc" },
      take: limit,
    }),
    // Aggregierte Gesamtsummen (unabhaengig vom result/source-Filter) - raw fuer
    // saubere Typisierung trotz tenant-extended client.
    db.$queryRawUnsafe<Array<{ result: string; cnt: bigint }>>(
      `
      SELECT result::text AS result, COUNT(*) AS cnt
      FROM "Scan"
      WHERE "accountId" = $1 AND "ticketId" = $2 AND "scanTime" >= $3
      GROUP BY result
      `,
      accountId!,
      employeeId,
      since,
    ),
    // Tages-Histogramm der letzten 14 Tage (granted vs denied).
    db.$queryRawUnsafe<Array<{ day: string; granted: bigint; denied: bigint }>>(
      `
      SELECT
        to_char(date_trunc('day', "scanTime" AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE result = 'GRANTED') AS granted,
        COUNT(*) FILTER (WHERE result <> 'GRANTED') AS denied
      FROM "Scan"
      WHERE "accountId" = $1
        AND "ticketId" = $2
        AND "scanTime" >= NOW() - INTERVAL '14 days'
      GROUP BY day
      ORDER BY day ASC
      `,
      accountId!,
      employeeId,
    ),
    // Top-Devices (granted only) im Zeitraum.
    db.$queryRawUnsafe<Array<{ deviceId: number | null; cnt: bigint }>>(
      `
      SELECT "deviceId", COUNT(*) AS cnt
      FROM "Scan"
      WHERE "accountId" = $1
        AND "ticketId" = $2
        AND "scanTime" >= $3
        AND result = 'GRANTED'
        AND "deviceId" IS NOT NULL
      GROUP BY "deviceId"
      ORDER BY cnt DESC
      LIMIT 5
      `,
      accountId!,
      employeeId,
      since,
    ),
  ]);

  const deviceIds = topDevicesRaw
    .map((d) => d.deviceId)
    .filter((x): x is number => x !== null);
  const devices = deviceIds.length
    ? await db.device.findMany({
        where: { id: { in: deviceIds } },
        select: { id: true, name: true, type: true, category: true },
      })
    : [];
  const deviceMap = new Map(devices.map((d) => [d.id, d]));

  const stats = {
    total:     totalsRaw.reduce((s, r) => s + Number(r.cnt), 0),
    granted:   Number(totalsRaw.find((r) => r.result === "GRANTED")?.cnt ?? 0),
    denied:    Number(totalsRaw.find((r) => r.result === "DENIED")?.cnt ?? 0),
    protected: Number(totalsRaw.find((r) => r.result === "PROTECTED")?.cnt ?? 0),
  };

  return NextResponse.json({
    range: { days, since: since.toISOString() },
    stats,
    byDay: byDayRaw.map((r) => ({
      day: r.day,
      granted: Number(r.granted),
      denied: Number(r.denied),
    })),
    topDevices: topDevicesRaw.map((d) => ({
      device: d.deviceId !== null ? (deviceMap.get(d.deviceId) ?? null) : null,
      count: Number(d.cnt),
    })),
    scans: scans.map((s) => ({
      id: s.id,
      code: s.code,
      note: s.note,
      result: s.result,
      scanTime: s.scanTime.toISOString(),
      device: s.device,
      source: deriveSource(s.code),
    })),
  });
}

function deriveSource(code: string): "mobile" | "dashboard" | "rfid" {
  if (code.startsWith("mobile:")) return "mobile";
  if (code === "Dashboard-Öffnung") return "dashboard";
  return "rfid";
}
