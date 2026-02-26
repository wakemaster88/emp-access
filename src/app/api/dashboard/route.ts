import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

interface AnnyMapping {
  mappings?: Record<string, number>;
  services?: string[];
  resources?: string[];
  resourceIds?: Record<string, string>;
}

interface AvailabilityPeriod {
  start: string;
  end: string;
}

async function fetchAnnyAvailability(
  baseUrl: string,
  token: string,
  resourceIds: string[],
  dateStr: string
): Promise<Record<string, AvailabilityPeriod[]>> {
  if (resourceIds.length === 0) return {};

  const startDate = `${dateStr}T00:00:00+01:00`;
  const endDate = `${dateStr}T23:59:59+01:00`;

  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, timezone: "Europe/Berlin" });
  for (const id of resourceIds) {
    params.append("r[]", id);
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/availability/periods?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const json = await res.json();
    const result: Record<string, AvailabilityPeriod[]> = {};
    for (const [rid, periods] of Object.entries(json)) {
      if (Array.isArray(periods)) {
        result[rid] = periods.map((p: Record<string, string>) => ({
          start: p.start || p.start_date || p.from || "",
          end: p.end || p.end_date || p.to || "",
        })).filter((p: AvailabilityPeriod) => p.start || p.end);
      }
    }
    return result;
  } catch {
    return {};
  }
}

function fmtTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function getBookingTimeForDate(qrCode: string | null, dateStr: string): { start: string; end: string } | null {
  if (!qrCode) return null;
  try {
    const entries = JSON.parse(qrCode);
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      if (entry.start && entry.start.includes(dateStr)) {
        return {
          start: fmtTime(entry.start),
          end: entry.end ? fmtTime(entry.end) : "",
        };
      }
    }
  } catch { /* not JSON */ }
  return null;
}

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId, isSuperAdmin } = session;
  const where = isSuperAdmin ? {} : { accountId: accountId! };

  const dateParam = request.nextUrl.searchParams.get("date");
  const selectedDate = dateParam ? new Date(dateParam + "T00:00:00") : new Date();
  if (isNaN(selectedDate.getTime())) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  const dayStart = new Date(selectedDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(selectedDate);
  dayEnd.setHours(23, 59, 59, 999);

  const dateStr = dayStart.toISOString().split("T")[0];

  const ticketDateFilter = {
    status: { in: ["VALID", "REDEEMED"] as ("VALID" | "REDEEMED")[] },
    OR: [
      { startDate: null, endDate: null },
      { startDate: { lte: dayEnd }, endDate: null },
      { startDate: null, endDate: { gte: dayStart } },
      { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
    ],
  };

  const ticketSelect = {
    id: true,
    name: true,
    firstName: true,
    lastName: true,
    ticketTypeName: true,
    status: true,
    startDate: true,
    endDate: true,
    validityType: true,
    slotStart: true,
    slotEnd: true,
    validityDurationMinutes: true,
    firstScanAt: true,
    profileImage: true,
    source: true,
    qrCode: true,
  };

  const [areas, scansToday, unassignedTickets, subscriptionTickets, annyConfig] = await Promise.all([
    db.accessArea.findMany({
      where: { ...where, showOnDashboard: true },
      select: {
        id: true,
        name: true,
        personLimit: true,
        allowReentry: true,
        openingHours: true,
        tickets: {
          where: ticketDateFilter,
          select: ticketSelect,
          orderBy: { name: "asc" },
        },
        _count: {
          select: { tickets: { where: ticketDateFilter } },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.scan.count({
      where: { ...where, scanTime: { gte: dayStart, lte: dayEnd } },
    }),
    db.ticket.findMany({
      where: { ...where, accessAreaId: null, subscriptionId: null, ...ticketDateFilter },
      select: ticketSelect,
      orderBy: { name: "asc" },
    }),
    db.ticket.findMany({
      where: { ...where, subscriptionId: { not: null }, ...ticketDateFilter },
      select: {
        ...ticketSelect,
        subscription: { select: { areas: { select: { id: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    db.apiConfig.findFirst({
      where: { ...(isSuperAdmin ? {} : { accountId: accountId! }), provider: "ANNY" },
      select: { token: true, baseUrl: true, extraConfig: true },
    }),
  ]);

  // Build: areaId → subscription tickets
  const subTicketsByArea = new Map<number, typeof subscriptionTickets>();
  for (const ticket of subscriptionTickets) {
    const subAreas = ticket.subscription?.areas || [];
    for (const sa of subAreas) {
      if (!subTicketsByArea.has(sa.id)) subTicketsByArea.set(sa.id, []);
      subTicketsByArea.get(sa.id)!.push(ticket);
    }
  }

  // Parse anny mapping
  let mappings: Record<string, number> = {};
  let resourceIds: Record<string, string> = {};
  let knownResources: Set<string> = new Set();
  let annyAvailability: Record<string, AvailabilityPeriod[]> = {};

  if (annyConfig?.token && annyConfig.extraConfig) {
    try {
      const parsed: AnnyMapping = JSON.parse(annyConfig.extraConfig);
      mappings = parsed.mappings || {};
      resourceIds = parsed.resourceIds || {};
      if (parsed.resources) parsed.resources.forEach((r) => knownResources.add(r));

      const allResIds = [...new Set(Object.values(resourceIds))];
      if (allResIds.length > 0) {
        const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
        annyAvailability = await fetchAnnyAvailability(baseUrl, annyConfig.token, allResIds, dateStr);
      }
    } catch { /* ignore */ }
  }

  // Build: areaId → [{ resourceName, resourceId }] — only actual resources, not services
  const areaResourceMap: Record<number, { name: string; resourceId: string }[]> = {};
  // Build: areaId → all mapped names (resources + services) for ticket matching
  const areaAllNames: Record<number, string[]> = {};
  for (const [name, areaId] of Object.entries(mappings)) {
    if (!areaAllNames[areaId]) areaAllNames[areaId] = [];
    areaAllNames[areaId].push(name);

    const resId = resourceIds[name];
    const isResource = knownResources.size === 0 || knownResources.has(name);
    if (resId && isResource) {
      if (!areaResourceMap[areaId]) areaResourceMap[areaId] = [];
      const exists = areaResourceMap[areaId].some((r) => r.resourceId === resId);
      if (!exists) areaResourceMap[areaId].push({ name, resourceId: resId });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function enrichTicket(ticket: any) {
    const bt = ticket.source === "ANNY" ? getBookingTimeForDate(ticket.qrCode, dateStr) : null;
    const { qrCode: _, ...rest } = ticket;
    return { ...rest, bookingStart: bt?.start || null, bookingEnd: bt?.end || null };
  }

  function ticketMatchesResource(ticketTypeName: string | null, resourceName: string): boolean {
    if (!ticketTypeName) return false;
    return ticketTypeName.startsWith(resourceName);
  }

  // Collect subscription ticket IDs for separation
  const subTicketIds = new Set(subscriptionTickets.map((t) => t.id));

  // Build structured area responses
  const structuredAreas = areas.map((area) => {
    const areaResources = areaResourceMap[area.id] || [];
    const areaSubTickets = (subTicketsByArea.get(area.id) || []).map(enrichTicket);
    const directTickets = area.tickets.map(enrichTicket);
    const seenIds = new Set(directTickets.map((t) => t.id));
    const mergedSubTickets = areaSubTickets.filter((t) => !seenIds.has(t.id));
    const enrichedTickets = [...directTickets, ...mergedSubTickets];
    const totalCount = area._count.tickets + mergedSubTickets.length;

    // Separate subscription tickets from regular tickets
    const regularTickets = enrichedTickets.filter((t) => !subTicketIds.has(t.id));
    const aboTickets = enrichedTickets.filter((t) => subTicketIds.has(t.id));

    if (areaResources.length === 0) {
      return {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        allowReentry: area.allowReentry,
        openingHours: area.openingHours,
        resources: [],
        otherTickets: regularTickets,
        aboTickets,
        _count: { tickets: totalCount },
      };
    }

    // Deduplicate resources by resourceId
    const seenResIds = new Set<string>();
    const uniqueResources = areaResources.filter((r) => {
      if (seenResIds.has(r.resourceId)) return false;
      seenResIds.add(r.resourceId);
      return true;
    });

    const matched = new Set<number>();
    const resources = uniqueResources
      .map((res) => {
        const periods = annyAvailability[res.resourceId] || [];
        const seenSlots = new Set<string>();
        const slots = periods
          .map((p) => ({ startTime: fmtTime(p.start), endTime: fmtTime(p.end) }))
          .filter((s) => {
            if (!s.startTime || !s.endTime) return false;
            const key = `${s.startTime}-${s.endTime}`;
            if (seenSlots.has(key)) return false;
            seenSlots.add(key);
            return true;
          })
          .sort((a, b) => a.startTime.localeCompare(b.startTime));

        // Match tickets: only match regular (non-abo) tickets
        const namesForArea = areaAllNames[area.id] || [];
        const resTickets = regularTickets.filter((t) => {
          if (matched.has(t.id)) return false;
          for (const name of namesForArea) {
            if (ticketMatchesResource(t.ticketTypeName, name)) {
              matched.add(t.id);
              return true;
            }
          }
          return false;
        });

        return { resourceName: res.name, slots, tickets: resTickets };
      })
      .sort((a, b) => {
        const aTime = a.slots[0]?.startTime || "99:99";
        const bTime = b.slots[0]?.startTime || "99:99";
        return aTime.localeCompare(bTime);
      });

    const otherTickets = regularTickets.filter((t) => !matched.has(t.id));

    // If there's only one resource with same/similar name as area, merge inline
    const isSingleMatch = resources.length === 1 &&
      (resources[0].resourceName === area.name ||
       area.name.startsWith(resources[0].resourceName) ||
       resources[0].resourceName.startsWith(area.name));

    if (isSingleMatch) {
      const r = resources[0];
      const uniqueSlotStrs = [...new Set(r.slots.map((s) => `${s.startTime}–${s.endTime}`))];
      const inlineHours = uniqueSlotStrs.length > 0
        ? uniqueSlotStrs.join(" · ")
        : area.openingHours;
      return {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        allowReentry: area.allowReentry,
        openingHours: inlineHours,
        resources: [],
        otherTickets: [...r.tickets, ...otherTickets],
        aboTickets,
        _count: { tickets: totalCount },
      };
    }

    return {
      id: area.id,
      name: area.name,
      personLimit: area.personLimit,
      allowReentry: area.allowReentry,
      openingHours: area.openingHours,
      resources,
      otherTickets,
      aboTickets,
      _count: { tickets: totalCount },
    };
  });

  return NextResponse.json({
    date: dateStr,
    scansToday,
    areas: structuredAreas,
    unassigned: {
      id: null,
      name: "Ohne Resource",
      personLimit: null,
      allowReentry: false,
      openingHours: null,
      resources: [],
      otherTickets: unassignedTickets.map(enrichTicket),
      aboTickets: [],
      _count: { tickets: unassignedTickets.length },
    },
  });
}
