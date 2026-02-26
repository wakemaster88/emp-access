import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
  });

  if (!monitor || !monitor.isActive) {
    return new Response("Monitor nicht gefunden oder inaktiv", { status: 404 });
  }

  const deviceIds = (monitor.deviceIds as number[]) ?? [];
  const accountId = monitor.accountId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client disconnected
        }
      };

      let lastScanId = 0;

      // Send monitor meta on connect
      const devices = await prisma.device.findMany({
        where: {
          accountId,
          ...(deviceIds.length ? { id: { in: deviceIds } } : {}),
        },
        select: { id: true, name: true, type: true, isActive: true, lastUpdate: true, task: true },
      });
      send({ type: "meta", data: { name: monitor.name, devices } });

      const poll = async () => {
        try {
          const scanWhere: Record<string, unknown> = {
            accountId,
            ...(deviceIds.length ? { deviceId: { in: deviceIds } } : {}),
            ...(lastScanId > 0 ? { id: { gt: lastScanId } } : {}),
          };

          const scans = await prisma.scan.findMany({
            where: scanWhere,
            include: {
              device: { select: { id: true, name: true } },
              ticket: { select: { name: true, firstName: true, lastName: true, validityType: true, validityDurationMinutes: true, firstScanAt: true, profileImage: true } },
            },
            orderBy: { id: "desc" },
            take: lastScanId === 0 ? 50 : 20,
          });

          if (scans.length > 0) {
            lastScanId = Math.max(...scans.map((s) => s.id));
            send({ type: "scans", data: scans });
          }

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const [granted, denied, total] = await Promise.all([
            prisma.scan.count({ where: { accountId, scanTime: { gte: today }, result: "GRANTED", ...(deviceIds.length ? { deviceId: { in: deviceIds } } : {}) } }),
            prisma.scan.count({ where: { accountId, scanTime: { gte: today }, result: "DENIED", ...(deviceIds.length ? { deviceId: { in: deviceIds } } : {}) } }),
            prisma.scan.count({ where: { accountId, scanTime: { gte: today }, ...(deviceIds.length ? { deviceId: { in: deviceIds } } : {}) } }),
          ]);

          send({ type: "stats", data: { granted, denied, total } });

          const updatedDevices = await prisma.device.findMany({
            where: { accountId, ...(deviceIds.length ? { id: { in: deviceIds } } : {}) },
            select: { id: true, name: true, type: true, isActive: true, lastUpdate: true, task: true },
          });
          send({ type: "devices", data: updatedDevices });
        } catch {
          // db error — continue polling
        }
      };

      await poll();
      const interval = setInterval(poll, 2000);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
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
