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
              ticket: { select: { id: true, name: true, firstName: true, lastName: true, ticketTypeName: true, validityType: true, validityDurationMinutes: true, firstScanAt: true, profileImage: true } },
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

          // Collect area IDs from monitored devices
          const monitoredDevices = await prisma.device.findMany({
            where: { accountId, ...(deviceIds.length ? { id: { in: deviceIds } } : {}) },
            select: { id: true, name: true, type: true, isActive: true, lastUpdate: true, task: true, accessIn: true, accessOut: true },
          });
          send({ type: "devices", data: monitoredDevices });

          const areaIds = [...new Set(
            monitoredDevices.flatMap((d) => [d.accessIn, d.accessOut].filter((id): id is number => id != null))
          )];

          const ticketWhere: Record<string, unknown> = {
            accountId,
            status: { in: ["VALID", "REDEEMED"] },
          };
          if (areaIds.length > 0) {
            ticketWhere.OR = [
              { accessAreaId: { in: areaIds } },
              { accessAreaId: null },
            ];
          }

          const tickets = await prisma.ticket.findMany({
            where: ticketWhere,
            select: {
              id: true,
              name: true,
              firstName: true,
              lastName: true,
              ticketTypeName: true,
              status: true,
              profileImage: true,
              validityType: true,
              validityDurationMinutes: true,
              firstScanAt: true,
              startDate: true,
              endDate: true,
              slotStart: true,
              slotEnd: true,
            },
            orderBy: { name: "asc" },
          });
          send({ type: "tickets", data: tickets });
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
