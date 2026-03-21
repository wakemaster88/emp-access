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
        select: { id: true, name: true, type: true, isActive: true, lastUpdate: true, task: true, accessIn: true, accessOut: true },
      });
      send({ type: "meta", data: { name: monitor.name, devices } });
      send({ type: "devices", data: devices });

      // Cache area IDs from initial device fetch to avoid re-querying every poll
      const cachedAreaIds = [...new Set(
        devices.flatMap((d: Record<string, unknown>) => [d.accessIn, d.accessOut].filter((id): id is number => id != null))
      )];
      let pollCount = 0;

      const pollScans = async () => {
        try {
          pollCount++;
          const scanWhere: Record<string, unknown> = {
            accountId,
            ...(deviceIds.length ? { deviceId: { in: deviceIds } } : {}),
            ...(lastScanId > 0 ? { id: { gt: lastScanId } } : {}),
          };

          const scans = await prisma.scan.findMany({
            where: scanWhere,
            include: {
              device: { select: { id: true, name: true } },
              ticket: { select: { id: true, name: true, firstName: true, lastName: true, birthDate: true, ticketTypeName: true, validityType: true, validityDurationMinutes: true, firstScanAt: true, endDate: true, subscriptionId: true, status: true } },
            },
            orderBy: { id: "desc" },
            take: lastScanId === 0 ? 50 : 20,
          });

          if (scans.length > 0) {
            lastScanId = Math.max(...scans.map((s) => s.id));
            send({ type: "scans", data: scans });
          }

          // Only refresh devices every 6th poll (~30s)
          if (pollCount % 6 === 0) {
            const refreshedDevices = await prisma.device.findMany({
              where: { accountId, ...(deviceIds.length ? { id: { in: deviceIds } } : {}) },
              select: { id: true, name: true, type: true, isActive: true, lastUpdate: true, task: true, accessIn: true, accessOut: true },
            });
            send({ type: "devices", data: refreshedDevices });
          }
        } catch {
          // db error — continue polling
        }
      };

      const pollTickets = async () => {
        try {
          const areaIds = cachedAreaIds;
          const now = new Date();
          const todayStart = new Date(now);
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date(now);
          todayEnd.setHours(23, 59, 59, 999);

          const ticketWhere: Record<string, unknown> = {
            accountId,
            status: { in: ["VALID", "REDEEMED", "PAUSED"] },
            OR: [
              { startDate: null },
              { startDate: { lte: todayEnd } },
            ],
            AND: [
              {
                OR: [
                  { endDate: null },
                  { endDate: { gte: todayStart } },
                ],
              },
            ],
          };
          if (areaIds.length > 0) {
            (ticketWhere.AND as Record<string, unknown>[]).push({
              OR: [
                { accessAreaId: { in: areaIds } },
                { ticketAreas: { some: { accessAreaId: { in: areaIds } } } },
                { subscription: { areas: { some: { id: { in: areaIds } } } } },
                { service: { serviceAreas: { some: { accessAreaId: { in: areaIds } } } } },
                { accessAreaId: null, subscriptionId: null, serviceId: null },
              ],
            });
          }

          const rawTickets = await prisma.ticket.findMany({
            where: ticketWhere,
            select: {
              id: true,
              name: true,
              firstName: true,
              lastName: true,
              birthDate: true,
              ticketTypeName: true,
              status: true,
              validityType: true,
              validityDurationMinutes: true,
              firstScanAt: true,
              startDate: true,
              endDate: true,
              slotStart: true,
              slotEnd: true,
              subscriptionId: true,
              source: true,
              extras: true,
            },
            orderBy: { name: "asc" },
          });
          const tickets = rawTickets.filter((t) => {
            if (t.validityType === "DURATION" && t.firstScanAt && t.validityDurationMinutes) {
              const expiresAt = new Date(t.firstScanAt).getTime() + t.validityDurationMinutes * 60_000;
              if (now.getTime() > expiresAt) return false;
            }
            return true;
          });
          send({ type: "tickets", data: tickets });
        } catch {
          // db error — continue
        }
      };

      // Initial load: scans + tickets
      await pollScans();
      await pollTickets();

      // Scans every 5s, tickets every 30s
      const scanInterval = setInterval(pollScans, 5000);
      const ticketInterval = setInterval(pollTickets, 30000);

      request.signal.addEventListener("abort", () => {
        clearInterval(scanInterval);
        clearInterval(ticketInterval);
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
