import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

interface AnnyMapping {
  mappings?: Record<string, number>;
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

  const [areas, scansToday, unassignedTickets, annyConfig] = await Promise.all([
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
      where: { ...where, accessAreaId: null, ...ticketDateFilter },
      select: ticketSelect,
      orderBy: { name: "asc" },
    }),
    db.apiConfig.findFirst({
      where: { ...(isSuperAdmin ? {} : { accountId: accountId! }), provider: "ANNY" },
      select: { token: true, baseUrl: true, extraConfig: true },
    }),
  ]);

  // Parse anny mapping
  let mappings: Record<string, number> = {};
  let resourceIds: Record<string, string> = {};
  let annyAvailability: Record<string, AvailabilityPeriod[]> = {};

  if (annyConfig?.token && annyConfig.extraConfig) {
    try {
      const parsed: AnnyMapping = JSON.parse(annyConfig.extraConfig);
      mappings = parsed.mappings || {};
      resourceIds = parsed.resourceIds || {};

      const allResIds = [...new Set(Object.values(resourceIds))];
      if (allResIds.length > 0) {
        const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
        annyAvailability = await fetchAnnyAvailability(baseUrl, annyConfig.token, allResIds, dateStr);
      }
    } catch { /* ignore */ }
  }

  // Build: areaId → [{ resourceName, resourceId }]
  const areaResourceMap: Record<number, { name: string; resourceId: string }[]> = {};
  for (const [name, areaId] of Object.entries(mappings)) {
    const resId = resourceIds[name];
    if (resId) {
      if (!areaResourceMap[areaId]) areaResourceMap[areaId] = [];
      const exists = areaResourceMap[areaId].some((r) => r.resourceId === resId && r.name === name);
      if (!exists) areaResourceMap[areaId].push({ name, resourceId: resId });
    }
  }

  // Build reverse: resourceId → name
  const resIdToName: Record<string, string> = {};
  for (const [name, resId] of Object.entries(resourceIds)) {
    resIdToName[resId] = name;
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

  // Build structured area responses
  const structuredAreas = areas.map((area) => {
    const areaResources = areaResourceMap[area.id] || [];
    const enrichedTickets = area.tickets.map(enrichTicket);

    if (areaResources.length === 0) {
      return {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        allowReentry: area.allowReentry,
        openingHours: area.openingHours,
        resources: [],
        otherTickets: enrichedTickets,
        _count: area._count,
      };
    }

    const matched = new Set<number>();
    const resources = areaResources
      .map((res) => {
        const periods = annyAvailability[res.resourceId] || [];
        const slots = periods
          .map((p) => ({ startTime: fmtTime(p.start), endTime: fmtTime(p.end) }))
          .filter((s) => s.startTime && s.endTime)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));

        const resTickets = enrichedTickets.filter((t) => {
          if (matched.has(t.id)) return false;
          if (ticketMatchesResource(t.ticketTypeName, res.name)) {
            matched.add(t.id);
            return true;
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

    const otherTickets = enrichedTickets.filter((t) => !matched.has(t.id));

    return {
      id: area.id,
      name: area.name,
      personLimit: area.personLimit,
      allowReentry: area.allowReentry,
      openingHours: area.openingHours,
      resources,
      otherTickets,
      _count: area._count,
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
      _count: { tickets: unassignedTickets.length },
    },
  });
}
