import type { PrismaClient } from "@prisma/client";

/** Wie Dashboard: Tickets mit Gültigkeit am Kalendertag (VALID / REDEEMED). */
export function ticketValidOnDayFilter(dayStart: Date, dayEnd: Date) {
  return {
    status: { in: ["VALID", "REDEEMED"] as ("VALID" | "REDEEMED")[] },
    OR: [
      { startDate: null, endDate: null },
      { startDate: { lte: dayEnd }, endDate: null },
      { startDate: null, endDate: { gte: dayStart } },
      { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
    ],
  };
}

export type ResourceUtilizationRow = {
  resourceId: number;
  name: string;
  /** Erwartete Gäste / gültige Tickets an diesem Tag (eindeutig pro Person/Ticket) */
  ticketCount: number;
  /** Kapazität aus Ressource (personLimit), sonst null */
  capacity: number | null;
  /** ticketCount / capacity, 0–1; null wenn keine Kapazität hinterlegt */
  utilization: number | null;
  /** utilization als Prozent 0–100, gerundet */
  utilizationPercent: number | null;
};

/**
 * Auslastung pro Ressource (AccessArea): eindeutige gültige Tickets am Tag vs. personLimit.
 * Zählung analog Dashboard: direkte Tickets + Abo-Zuordnung + Service-Zuordnung + TicketArea-Links.
 */
export async function computeResourceUtilization(
  db: PrismaClient,
  accountId: number,
  dayStart: Date,
  dayEnd: Date,
  options?: { onlyShowOnDashboard?: boolean },
): Promise<ResourceUtilizationRow[]> {
  const onlyDash = options?.onlyShowOnDashboard ?? true;
  const ticketDateFilter = ticketValidOnDayFilter(dayStart, dayEnd);

  const [areas, subscriptionTickets, serviceTickets, ticketAreaRows] = await Promise.all([
    db.accessArea.findMany({
      where: { accountId, ...(onlyDash ? { showOnDashboard: true } : {}) },
      select: {
        id: true,
        name: true,
        personLimit: true,
        tickets: {
          where: ticketDateFilter,
          select: { id: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.ticket.findMany({
      where: { accountId, subscriptionId: { not: null }, ...ticketDateFilter },
      select: {
        id: true,
        subscription: { select: { areas: { select: { id: true } } } },
      },
    }),
    db.ticket.findMany({
      where: { accountId, serviceId: { not: null }, ...ticketDateFilter },
      select: {
        id: true,
        service: { select: { serviceAreas: { select: { area: { select: { id: true } } } } } },
      },
    }),
    db.ticketArea.findMany({
      where: {
        ticket: { accountId, ...ticketDateFilter },
      },
      select: { accessAreaId: true, ticketId: true },
    }),
  ]);

  const subByArea = new Map<number, Set<number>>();
  for (const ticket of subscriptionTickets) {
    for (const a of ticket.subscription?.areas ?? []) {
      if (!subByArea.has(a.id)) subByArea.set(a.id, new Set());
      subByArea.get(a.id)!.add(ticket.id);
    }
  }

  const svcByArea = new Map<number, Set<number>>();
  for (const ticket of serviceTickets) {
    for (const sa of ticket.service?.serviceAreas ?? []) {
      const aid = sa.area?.id;
      if (aid == null) continue;
      if (!svcByArea.has(aid)) svcByArea.set(aid, new Set());
      svcByArea.get(aid)!.add(ticket.id);
    }
  }

  const extraByArea = new Map<number, Set<number>>();
  for (const row of ticketAreaRows) {
    if (!extraByArea.has(row.accessAreaId)) extraByArea.set(row.accessAreaId, new Set());
    extraByArea.get(row.accessAreaId)!.add(row.ticketId);
  }

  return areas.map((area) => {
    const ids = new Set<number>();
    for (const t of area.tickets) ids.add(t.id);
    for (const id of subByArea.get(area.id) ?? []) ids.add(id);
    for (const id of svcByArea.get(area.id) ?? []) ids.add(id);
    for (const id of extraByArea.get(area.id) ?? []) ids.add(id);

    const ticketCount = ids.size;
    const capacity = area.personLimit ?? null;
    const utilization =
      capacity != null && capacity > 0 ? Math.min(1, ticketCount / capacity) : null;
    const utilizationPercent =
      utilization != null ? Math.round(utilization * 1000) / 10 : null;

    return {
      resourceId: area.id,
      name: area.name,
      ticketCount,
      capacity,
      utilization,
      utilizationPercent,
    };
  });
}
