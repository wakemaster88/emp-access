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

  let counts: { areaId: number; current: number; entries: number; exits: number }[] | null = null;
  if (areaIds?.length) {
    const today = berlinDayStart();
    const baseWhere = { accountId: accountId!, scanTime: { gte: today }, result: { in: ["GRANTED" as const, "PROTECTED" as const] } };
    counts = await Promise.all(
      areaIds.map(async (areaId) => {
        const [entries, exits] = await Promise.all([
          db.scan.count({ where: { ...baseWhere, device: { accessIn: areaId } } }),
          db.scan.count({ where: { ...baseWhere, device: { accessOut: areaId } } }),
        ]);
        return { areaId, current: entries - exits, entries, exits };
      })
    );
  }

  // Geräte-Liste unabhängig vom Feed-Filter (deviceIds/areaIds), damit
  // Filter-Dropdown und Quick-Öffnen-Buttons immer alle Geräte zeigen.
  const devices = await db.device.findMany({
    where: { accountId: accountId! },
    select: { id: true, name: true, type: true, category: true, isActive: true, lastUpdate: true, task: true },
  });

  const lastScanId = scans.length > 0 ? Math.max(...scans.map((s) => s.id)) : since;

  return NextResponse.json(
    { scans, counts, devices, lastScanId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
