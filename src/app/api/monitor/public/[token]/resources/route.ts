import { NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import {
  fetchAnnyAvailability,
  fmtTimeBerlin,
  periodsToSlots,
  type AnnyMapping,
} from "@/lib/anny-availability";
import { ticketValidOnDayFilter } from "@/lib/resource-utilization";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const config = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, type: true, accountId: true, isActive: true, deviceIds: true },
  });

  if (!config || config.type !== "RESOURCE_MONITOR" || !config.isActive) {
    return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
  }

  const accountId = config.accountId;
  const db = tenantClient(accountId);

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  const y = dayStart.getFullYear();
  const m = String(dayStart.getMonth() + 1).padStart(2, "0");
  const d = String(dayStart.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  const selectedAreaIds = (config.deviceIds as number[]) ?? [];
  const ticketDateFilter = ticketValidOnDayFilter(dayStart, dayEnd);

  const [areas, annyConfig, subscriptionTickets, serviceTickets] = await Promise.all([
    db.accessArea.findMany({
      where: {
        accountId,
        ...(selectedAreaIds.length > 0 ? { id: { in: selectedAreaIds } } : { showOnDashboard: true }),
      },
      select: {
        id: true,
        name: true,
        personLimit: true,
        tickets: {
          where: ticketDateFilter,
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            ticketTypeName: true,
            startDate: true,
            endDate: true,
            source: true,
            qrCode: true,
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.apiConfig.findFirst({
      where: { accountId, provider: "ANNY" },
      select: { token: true, baseUrl: true, extraConfig: true },
    }),
    db.ticket.findMany({
      where: { accountId, subscriptionId: { not: null }, ...ticketDateFilter },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
        startDate: true,
        endDate: true,
        source: true,
        qrCode: true,
        subscription: { select: { areas: { select: { id: true } } } },
      },
    }),
    db.ticket.findMany({
      where: { accountId, serviceId: { not: null }, ...ticketDateFilter },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
        startDate: true,
        endDate: true,
        source: true,
        qrCode: true,
        service: { select: { serviceAreas: { select: { area: { select: { id: true } } } } } },
      },
    }),
  ]);

  const subByArea = new Map<number, typeof subscriptionTickets>();
  for (const t of subscriptionTickets) {
    for (const a of t.subscription?.areas ?? []) {
      if (!subByArea.has(a.id)) subByArea.set(a.id, []);
      subByArea.get(a.id)!.push(t);
    }
  }
  const svcByArea = new Map<number, typeof serviceTickets>();
  for (const t of serviceTickets) {
    for (const sa of t.service?.serviceAreas ?? []) {
      const aid = sa.area?.id;
      if (aid == null) continue;
      if (!svcByArea.has(aid)) svcByArea.set(aid, []);
      svcByArea.get(aid)!.push(t);
    }
  }

  let mappings: Record<string, number> = {};
  let resourceIds: Record<string, string> = {};
  let annyAvailability: Record<string, { start: string; end: string }[]> = {};

  if (annyConfig?.token && annyConfig.extraConfig) {
    try {
      const parsed: AnnyMapping = JSON.parse(annyConfig.extraConfig);
      mappings = parsed.mappings ?? {};
      resourceIds = parsed.resourceIds ?? {};
      const allRids = [...new Set(Object.values(resourceIds))];
      if (allRids.length > 0) {
        const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
        annyAvailability = await fetchAnnyAvailability(baseUrl, annyConfig.token, allRids, dateStr);
      }
    } catch { /* ignore */ }
  }

  const areaAnnyIds = new Map<number, string[]>();
  for (const [name, areaId] of Object.entries(mappings)) {
    const rid = resourceIds[name];
    if (!rid) continue;
    if (!areaAnnyIds.has(areaId)) areaAnnyIds.set(areaId, []);
    const list = areaAnnyIds.get(areaId)!;
    if (!list.includes(rid)) list.push(rid);
  }

  function bookingSlot(
    ticket: { source: string | null; qrCode: string | null; startDate: Date | null; endDate: Date | null },
  ): { start: string; end: string } | null {
    if (ticket.source === "ANNY" && ticket.qrCode) {
      try {
        const entries = JSON.parse(ticket.qrCode);
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (e.start && e.start.includes(dateStr)) {
              return {
                start: fmtTimeBerlin(e.start),
                end: e.end ? fmtTimeBerlin(e.end) : "",
              };
            }
          }
        }
      } catch { /* not JSON */ }
    }
    if (ticket.startDate && ticket.startDate >= dayStart && ticket.startDate <= dayEnd) {
      const s = fmtTimeBerlin(ticket.startDate.toISOString());
      const e = ticket.endDate ? fmtTimeBerlin(ticket.endDate.toISOString()) : "";
      if (s) return { start: s, end: e };
    }
    return null;
  }

  function displayName(t: { name: string; firstName: string | null; lastName: string | null }) {
    const n = [t.firstName, t.lastName].filter(Boolean).join(" ").trim();
    return n || t.name;
  }

  const resources = areas.map((area) => {
    const rids = areaAnnyIds.get(area.id) ?? [];
    const allPeriods = rids.flatMap((rid) => annyAvailability[rid] ?? []);
    const slots = periodsToSlots(allPeriods);

    const seen = new Set<number>();
    const allTickets = [...area.tickets];
    for (const t of subByArea.get(area.id) ?? []) {
      if (!seen.has(t.id)) { seen.add(t.id); allTickets.push(t); }
    }
    for (const t of svcByArea.get(area.id) ?? []) {
      if (!seen.has(t.id)) { seen.add(t.id); allTickets.push(t); }
    }

    const bookings = allTickets
      .map((t) => {
        const slot = bookingSlot(t);
        return slot
          ? { name: displayName(t), typeName: t.ticketTypeName, start: slot.start, end: slot.end }
          : null;
      })
      .filter((b): b is NonNullable<typeof b> => b != null && !!b.start)
      .sort((a, b) => a.start.localeCompare(b.start));

    return {
      id: area.id,
      name: area.name,
      capacity: area.personLimit,
      availability: slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime })),
      bookingCount: allTickets.length,
      bookings,
    };
  });

  return NextResponse.json({
    date: dateStr,
    now: now.toISOString(),
    resources,
  });
}
