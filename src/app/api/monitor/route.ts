import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { berlinDayStart } from "@/lib/berlin-day";

/**
 * Live-Daten fuer den Dashboard-Leitstand – kurzes Polling statt SSE.
 *
 * Der fruehere Event-Stream hielt pro offenem Tab eine Function-Instanz
 * dauerhaft offen (Fluid Compute rechnet Speicher × Laufzeit ab) und fragte
 * darin alle fuenf Sekunden die Datenbank. Jetzt holt der Client alle paar
 * Sekunden nur die Scans seit `since`; der Rest bleibt gleich.
 *
 * Query: since=<letzte Scan-ID> (0 = heutige Scans), devices=1,2, areas=1,2
 */
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const areaIds = request.nextUrl.searchParams.get("areas")?.split(",").map(Number).filter(Boolean);
  const deviceIds = request.nextUrl.searchParams.get("devices")?.split(",").map(Number).filter(Boolean);
  const since = Number(request.nextUrl.searchParams.get("since") ?? "0") || 0;

  const scanWhere: Record<string, unknown> = {
    accountId: accountId!,
    ...(since > 0 ? { id: { gt: since } } : { scanTime: { gte: berlinDayStart() } }),
  };
  if (deviceIds?.length) scanWhere.deviceId = { in: deviceIds };

  const scans = await db.scan.findMany({
    where: scanWhere,
    select: {
      id: true, code: true, note: true, scanTime: true, result: true, deviceId: true, ticketId: true,
      device: { select: { id: true, name: true, type: true, accessIn: true, accessOut: true } },
      ticket: { select: { id: true, name: true, firstName: true, lastName: true, ticketTypeName: true, status: true, accessAreaId: true, subscriptionId: true, profileImage: true, startDate: true, endDate: true, accessArea: { select: { name: true } } } },
    },
    orderBy: { id: "desc" },
    take: since === 0 ? 100 : 50,
  });

  // Geräte-Liste unabhängig vom Feed-Filter (deviceIds/areaIds), damit
  // Filter-Dropdown und Quick-Öffnen-Buttons immer alle Geräte zeigen.
  // accessIn/accessOut dienen nur der Bereichszählung und gehen nicht in die
  // Antwort.
  const today = berlinDayStart();
  const [deviceRows, scansPerDevice] = await Promise.all([
    db.device.findMany({
      where: { accountId: accountId! },
      select: { id: true, name: true, type: true, category: true, isActive: true, lastUpdate: true, task: true, accessIn: true, accessOut: true },
    }),
    areaIds?.length
      ? db.scan.groupBy({
          by: ["deviceId"],
          where: { accountId: accountId!, scanTime: { gte: today }, result: { in: ["GRANTED", "PROTECTED"] } },
          _count: { _all: true },
        })
      : Promise.resolve(null),
  ]);
  const devices = deviceRows.map((d) => ({
    id: d.id, name: d.name, type: d.type, category: d.category, isActive: d.isActive, lastUpdate: d.lastUpdate, task: d.task,
  }));

  // Bereichszähler: eine Gruppierung je Gerät statt zwei Zählabfragen je
  // Bereich. Eintritt = Scans an Geräten mit accessIn = Bereich, Austritt =
  // Scans an Geräten mit accessOut = Bereich.
  let counts: { areaId: number; current: number; entries: number; exits: number }[] | null = null;
  if (areaIds?.length && scansPerDevice) {
    const deviceById = new Map(deviceRows.map((d) => [d.id, d]));
    counts = areaIds.map((areaId) => {
      let entries = 0;
      let exits = 0;
      for (const row of scansPerDevice) {
        if (row.deviceId == null) continue;
        const device = deviceById.get(row.deviceId);
        if (!device) continue;
        if (device.accessIn === areaId) entries += row._count._all;
        if (device.accessOut === areaId) exits += row._count._all;
      }
      return { areaId, current: entries - exits, entries, exits };
    });
  }

  const lastScanId = scans.length > 0 ? Math.max(...scans.map((s) => s.id)) : since;

  return NextResponse.json(
    { scans, counts, devices, lastScanId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
