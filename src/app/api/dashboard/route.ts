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
    // Response: { "resourceId": [{ start, end, ... }, ...], ... }
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
          where: {
            status: { in: ["VALID", "REDEEMED"] },
            OR: [
              { startDate: null, endDate: null },
              { startDate: { lte: dayEnd }, endDate: null },
              { startDate: null, endDate: { gte: dayStart } },
              { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
            ],
          },
          select: {
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
          },
          orderBy: { name: "asc" },
        },
        _count: {
          select: {
            tickets: {
              where: {
                status: { in: ["VALID", "REDEEMED"] },
                OR: [
                  { startDate: null, endDate: null },
                  { startDate: { lte: dayEnd }, endDate: null },
                  { startDate: null, endDate: { gte: dayStart } },
                  { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
                ],
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.scan.count({
      where: { ...where, scanTime: { gte: dayStart, lte: dayEnd } },
    }),
    db.ticket.findMany({
      where: {
        ...where,
        accessAreaId: null,
        status: { in: ["VALID", "REDEEMED"] },
        OR: [
          { startDate: null, endDate: null },
          { startDate: { lte: dayEnd }, endDate: null },
          { startDate: null, endDate: { gte: dayStart } },
          { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
        ],
      },
      select: {
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
      },
      orderBy: { name: "asc" },
    }),
    db.apiConfig.findFirst({
      where: { ...(isSuperAdmin ? {} : { accountId: accountId! }), provider: "ANNY" },
      select: { token: true, baseUrl: true, extraConfig: true },
    }),
  ]);

  // Build anny resource → area mapping and fetch availability
  let areaAvailability: Record<number, string[]> = {};

  if (annyConfig?.token && annyConfig.extraConfig) {
    try {
      const parsed: AnnyMapping = JSON.parse(annyConfig.extraConfig);
      const mappings = parsed.mappings || {};
      const resourceIds = parsed.resourceIds || {};

      // Build reverse map: areaId → resourceId(s)
      const areaToResources: Record<number, string[]> = {};
      const allResourceIds: string[] = [];

      for (const [name, areaId] of Object.entries(mappings)) {
        const resId = resourceIds[name];
        if (resId) {
          if (!areaToResources[areaId]) areaToResources[areaId] = [];
          if (!areaToResources[areaId].includes(resId)) {
            areaToResources[areaId].push(resId);
          }
          if (!allResourceIds.includes(resId)) allResourceIds.push(resId);
        }
      }

      if (allResourceIds.length > 0) {
        const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
        const periods = await fetchAnnyAvailability(baseUrl, annyConfig.token, allResourceIds, dateStr);

        for (const [areaId, resIds] of Object.entries(areaToResources)) {
          const slots: string[] = [];
          for (const resId of resIds) {
            const resPeriods = periods[resId];
            if (resPeriods && resPeriods.length > 0) {
              for (const p of resPeriods) {
                const start = fmtTime(p.start);
                const end = fmtTime(p.end);
                if (start && end) slots.push(`${start}–${end}`);
              }
            }
          }
          if (slots.length > 0) {
            areaAvailability[Number(areaId)] = slots;
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // Merge availability into areas
  const areasWithAvailability = areas.map((area) => ({
    ...area,
    availability: areaAvailability[area.id] || null,
  }));

  return NextResponse.json({
    date: dateStr,
    scansToday,
    areas: areasWithAvailability,
    unassigned: {
      id: null,
      name: "Ohne Bereich",
      personLimit: null,
      allowReentry: false,
      openingHours: null,
      availability: null,
      tickets: unassignedTickets,
      _count: { tickets: unassignedTickets.length },
    },
  });
}
