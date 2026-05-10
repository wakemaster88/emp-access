import { NextRequest } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { berlinDayStart } from "@/lib/berlin-day";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const areaIds = request.nextUrl.searchParams.get("areas")?.split(",").map(Number).filter(Boolean);
  const deviceIds = request.nextUrl.searchParams.get("devices")?.split(",").map(Number).filter(Boolean);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let lastScanId = 0;

      const poll = async () => {
        try {
          const scanWhere: Record<string, unknown> = {
            accountId: accountId!,
            ...(lastScanId > 0
              ? { id: { gt: lastScanId } }
              : { scanTime: { gte: berlinDayStart() } }),
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
            take: lastScanId === 0 ? 100 : 20,
          });

          if (scans.length > 0) {
            lastScanId = Math.max(...scans.map((s) => s.id));
            sendEvent({ type: "scans", data: scans });
          }

          if (areaIds?.length) {
            const today = berlinDayStart();
            const baseWhere = { accountId: accountId!, scanTime: { gte: today }, result: { in: ["GRANTED" as const, "PROTECTED" as const] } };
            const counts = await Promise.all(
              areaIds.map(async (areaId) => {
                const [entries, exits] = await Promise.all([
                  db.scan.count({ where: { ...baseWhere, device: { accessIn: areaId } } }),
                  db.scan.count({ where: { ...baseWhere, device: { accessOut: areaId } } }),
                ]);
                return { areaId, current: entries - exits, entries, exits };
              })
            );
            sendEvent({ type: "counts", data: counts });
          }

          // Geräte-Liste unabhängig vom Feed-Filter (deviceIds/areaIds), damit
          // Filter-Dropdown und Quick-Öffnen-Buttons immer alle Geräte zeigen.
          const devices = await db.device.findMany({
            where: { accountId: accountId! },
            select: { id: true, name: true, type: true, category: true, isActive: true, lastUpdate: true, task: true },
          });
          sendEvent({ type: "devices", data: devices });
        } catch {
          sendEvent({ type: "error", data: "polling failed" });
        }
      };

      await poll();
      const interval = setInterval(poll, 5000);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
