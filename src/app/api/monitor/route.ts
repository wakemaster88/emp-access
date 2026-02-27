import { NextRequest } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

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
          const whereDevice: Record<string, unknown> = {};
          if (deviceIds?.length) whereDevice.id = { in: deviceIds };
          if (areaIds?.length) {
            whereDevice.OR = [
              { accessIn: { in: areaIds } },
              { accessOut: { in: areaIds } },
            ];
          }

          const scanWhere: Record<string, unknown> = {
            accountId: accountId!,
            ...(lastScanId > 0 ? { id: { gt: lastScanId } } : {}),
          };
          if (deviceIds?.length) scanWhere.deviceId = { in: deviceIds };

          const scans = await db.scan.findMany({
            where: scanWhere,
            include: {
              device: true,
              ticket: { include: { accessArea: { select: { name: true } } } },
            },
            orderBy: { id: "desc" },
            take: lastScanId === 0 ? 100 : 20,
          });

          if (scans.length > 0) {
            lastScanId = Math.max(...scans.map((s) => s.id));
            sendEvent({ type: "scans", data: scans });
          }

          if (areaIds?.length) {
            const counts = await Promise.all(
              areaIds.map(async (areaId) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const entries = await db.scan.count({
                  where: {
                    accountId: accountId!,
                    scanTime: { gte: today },
                    result: { in: ["GRANTED", "PROTECTED"] },
                    device: { accessIn: areaId },
                  },
                });
                const exits = await db.scan.count({
                  where: {
                    accountId: accountId!,
                    scanTime: { gte: today },
                    result: { in: ["GRANTED", "PROTECTED"] },
                    device: { accessOut: areaId },
                  },
                });

                return { areaId, current: entries - exits, entries, exits };
              })
            );
            sendEvent({ type: "counts", data: counts });
          }

          const devices = await db.device.findMany({
            where: { accountId: accountId!, ...whereDevice },
            select: { id: true, name: true, type: true, isActive: true, lastUpdate: true, task: true },
          });
          sendEvent({ type: "devices", data: devices });
        } catch {
          sendEvent({ type: "error", data: "polling failed" });
        }
      };

      await poll();
      const interval = setInterval(poll, 2000);

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
