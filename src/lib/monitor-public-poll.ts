import type { PrismaClient } from "@prisma/client";

const MAX_TICKETS = 2500;

export type PublicMonitorPollResult = {
  name: string;
  devices: Awaited<ReturnType<typeof loadDevices>>;
  scans: Awaited<ReturnType<typeof loadScans>>;
  tickets: Awaited<ReturnType<typeof loadTickets>> | null;
  /** Höchste Scan-ID in dieser Antwort (für sinceScanId beim nächsten Poll) */
  lastScanId: number;
};

async function loadDevices(
  prisma: PrismaClient,
  accountId: number,
  deviceIds: number[]
) {
  return prisma.device.findMany({
    where: { accountId, ...(deviceIds.length ? { id: { in: deviceIds } } : {}) },
    select: { id: true, name: true, type: true, isActive: true, lastUpdate: true, task: true, accessIn: true, accessOut: true },
  });
}

async function loadScans(
  prisma: PrismaClient,
  accountId: number,
  deviceIds: number[],
  sinceScanId: number
) {
  const scanWhere: Record<string, unknown> = {
    accountId,
    ...(deviceIds.length ? { deviceId: { in: deviceIds } } : {}),
    ...(sinceScanId > 0 ? { id: { gt: sinceScanId } } : {}),
  };
  return prisma.scan.findMany({
    where: scanWhere,
    include: {
      device: { select: { id: true, name: true } },
      ticket: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          birthDate: true,
          ticketTypeName: true,
          validityType: true,
          validityDurationMinutes: true,
          firstScanAt: true,
          endDate: true,
          subscriptionId: true,
          status: true,
        },
      },
    },
    orderBy: { id: "desc" },
    take: sinceScanId === 0 ? 50 : 25,
  });
}

async function loadTickets(
  prisma: PrismaClient,
  accountId: number,
  devices: { accessIn: number | null; accessOut: number | null }[]
) {
  const cachedAreaIds = [...new Set(
    devices.flatMap((d) => [d.accessIn, d.accessOut].filter((id): id is number => id != null))
  )];
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const ticketWhere: Record<string, unknown> = {
    accountId,
    status: { in: ["VALID", "REDEEMED", "PAUSED"] },
    OR: [{ startDate: null }, { startDate: { lte: todayEnd } }],
    AND: [
      { OR: [{ endDate: null }, { endDate: { gte: todayStart } }] },
    ],
  };
  if (cachedAreaIds.length > 0) {
    (ticketWhere.AND as Record<string, unknown>[]).push({
      OR: [
        { accessAreaId: { in: cachedAreaIds } },
        { ticketAreas: { some: { accessAreaId: { in: cachedAreaIds } } } },
        { subscription: { areas: { some: { id: { in: cachedAreaIds } } } } },
        { service: { serviceAreas: { some: { accessAreaId: { in: cachedAreaIds } } } } },
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
    take: MAX_TICKETS,
  });

  return rawTickets.filter((t) => {
    if (t.validityType === "DURATION" && t.firstScanAt && t.validityDurationMinutes) {
      const expiresAt = new Date(t.firstScanAt).getTime() + t.validityDurationMinutes * 60_000;
      if (now.getTime() > expiresAt) return false;
    }
    return true;
  });
}

/**
 * Ein kurzer Poll (ohne SSE) – hält Vercel & Neon pro Request unter ~10s.
 */
export async function runPublicMonitorPoll(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    deviceIds: number[];
    monitorName: string;
    sinceScanId: number;
    includeTickets: boolean;
  }
): Promise<PublicMonitorPollResult> {
  const { accountId, deviceIds, monitorName, sinceScanId, includeTickets } = opts;

  const devices = await loadDevices(prisma, accountId, deviceIds);
  const scans = await loadScans(prisma, accountId, deviceIds, sinceScanId);

  let lastScanId = sinceScanId;
  if (scans.length > 0) {
    lastScanId = Math.max(...scans.map((s) => s.id));
  }

  const tickets = includeTickets ? await loadTickets(prisma, accountId, devices) : null;

  return {
    name: monitorName,
    devices,
    scans,
    tickets,
    lastScanId,
  };
}
