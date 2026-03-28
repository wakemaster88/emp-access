import { NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import {
  fetchAnnyAvailability,
  fmtTimeBerlin,
  type AnnyMapping,
} from "@/lib/anny-availability";
import { normalizeAnnyBookingsResponse } from "@/lib/anny-jsonapi";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TimeSlot {
  start: string;
  end: string;
  status: "free" | "booked";
  count: number;
  names: string[];
  capacity: number | null;
  source?: string;
  isPublic?: boolean;
}

interface BookingEntry {
  start: string;
  end: string;
  customerName: string;
  resourceId: string | null;
  resourceName: string | null;
  serviceName: string | null;
}

/**
 * Fetches ALL bookings from ANNY, filters to the target day client-side,
 * and returns flat list with resource/service info for flexible matching.
 * Uses same params as the proven sync code (no ANNY-specific date filters).
 */
async function fetchAllAnnyBookingsForDay(
  baseUrl: string,
  apiToken: string,
  dateStr: string,
): Promise<BookingEntry[]> {
  const result: BookingEntry[] = [];
  const cancelledStatuses = new Set(["cancelled", "canceled", "rejected", "no_show"]);
  let page = 1;
  const pageSize = 100;

  try {
    while (page <= 20) {
      const params = new URLSearchParams({
        include: "customer,resource,service",
        "page[size]": String(pageSize),
        "page[number]": String(page),
      });

      const res = await fetch(`${baseUrl}/api/v1/bookings?${params}`, {
        headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) break;

      const json = await res.json();
      const bookings = normalizeAnnyBookingsResponse(json);

      for (const booking of bookings) {
        const status = (booking.status || "").toLowerCase();
        if (cancelledStatuses.has(status)) continue;

        if (!booking.start_date) continue;
        try {
          const bd = new Date(booking.start_date)
            .toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
          if (bd !== dateStr) continue;
        } catch { continue; }

        const cust = booking.customer;
        const customerName =
          cust?.full_name || cust?.name ||
          `${cust?.given_name || ""} ${cust?.family_name || ""}`.trim();

        result.push({
          start: fmtTimeBerlin(booking.start_date),
          end: booking.end_date ? fmtTimeBerlin(booking.end_date) : "",
          customerName,
          resourceId: booking.resource?.id ? String(booking.resource.id) : null,
          resourceName: booking.resource?.name || null,
          serviceName: booking.service?.name || null,
        });
      }

      if (bookings.length < pageSize) break;
      page++;
    }
  } catch { /* ignore */ }

  return result;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const config = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, name: true, type: true, accountId: true, isActive: true, deviceIds: true },
  });

  if (!config || config.type !== "RESOURCE_MONITOR" || !config.isActive) {
    return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
  }

  const accountId = config.accountId;
  const db = tenantClient(accountId);

  const now = new Date();
  const berlinDate = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

  const url = new URL(request.url);
  const queryDate = url.searchParams.get("date");
  const dateStr = queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate) ? queryDate : berlinDate;

  const selectedAreaIds = (config.deviceIds as number[]) ?? [];

  const [areas, annyConfig] = await Promise.all([
    db.accessArea.findMany({
      where: {
        accountId,
        ...(selectedAreaIds.length > 0 ? { id: { in: selectedAreaIds } } : { showOnDashboard: true }),
      },
      select: { id: true, name: true, personLimit: true },
      orderBy: { name: "asc" },
    }),
    db.apiConfig.findFirst({
      where: { accountId, provider: "ANNY" },
      select: { token: true, baseUrl: true, extraConfig: true },
    }),
  ]);

  let mappings: Record<string, number> = {};
  let resourceIds: Record<string, string> = {};
  let annyAvailability: Record<string, { start: string; end: string }[]> = {};
  let allBookings: BookingEntry[] = [];
  let baseUrl = "";

  if (annyConfig?.token && annyConfig.extraConfig) {
    try {
      const parsed: AnnyMapping = JSON.parse(annyConfig.extraConfig);
      mappings = parsed.mappings ?? {};
      resourceIds = parsed.resourceIds ?? {};
      baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
      const allRids = [...new Set(Object.values(resourceIds))];

      const [avail, bookings] = await Promise.all([
        allRids.length > 0
          ? fetchAnnyAvailability(baseUrl, annyConfig.token, allRids, dateStr)
          : Promise.resolve({} as Record<string, { start: string; end: string }[]>),
        fetchAllAnnyBookingsForDay(baseUrl, annyConfig.token, dateStr),
      ]);
      annyAvailability = avail;
      allBookings = bookings;
    } catch { /* ignore */ }
  }

  const areaAnnyIds = new Map<number, string[]>();
  const areaRidLabels = new Map<string, Set<string>>();
  const areaRidPublic = new Map<string, boolean>();

  function cleanLabel(name: string): string {
    let l = name.replace(/^Wake & Ski\s*-\s*/i, "");
    if (l.includes(" - ")) l = l.split(" - ")[0].trim();
    return l;
  }

  for (const [name, areaId] of Object.entries(mappings)) {
    const rid = resourceIds[name];
    if (!rid) continue;

    const mapKey = `${areaId}:${rid}`;
    if (!areaRidLabels.has(mapKey)) areaRidLabels.set(mapKey, new Set());
    areaRidLabels.get(mapKey)!.add(cleanLabel(name));

    if (/öffentlich/i.test(name)) areaRidPublic.set(mapKey, true);

    if (!areaAnnyIds.has(areaId)) areaAnnyIds.set(areaId, []);
    const list = areaAnnyIds.get(areaId)!;
    if (!list.includes(rid)) list.push(rid);
  }

  function timeToMin(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  }

  function minToTime(m: number): string {
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  function subtractIntervals(
    free: { start: number; end: number }[],
    booked: { start: number; end: number }[],
  ): { start: number; end: number }[] {
    let result = [...free];
    for (const b of booked) {
      const next: { start: number; end: number }[] = [];
      for (const f of result) {
        if (b.end <= f.start || b.start >= f.end) {
          next.push(f);
        } else {
          if (f.start < b.start) next.push({ start: f.start, end: b.start });
          if (f.end > b.end) next.push({ start: b.end, end: f.end });
        }
      }
      result = next;
    }
    return result;
  }

  const resources = areas.map((area) => {
    const rids = areaAnnyIds.get(area.id) ?? [];

    const mappedNames = new Set<string>();
    for (const [name, aid] of Object.entries(mappings)) {
      if (aid === area.id) mappedNames.add(name);
    }

    const bookedSlotMap = new Map<string, { start: string; end: string; count: number; names: string[] }>();
    for (const b of allBookings) {
      const matchByRid = b.resourceId != null && rids.includes(b.resourceId);
      const matchByResName = b.resourceName != null && mappedNames.has(b.resourceName);
      const matchBySvcName = b.serviceName != null && mappedNames.has(b.serviceName);
      if (!matchByRid && !matchByResName && !matchBySvcName) continue;
      if (!b.start || !b.end) continue;

      const key = `${b.start}-${b.end}`;
      const existing = bookedSlotMap.get(key);
      if (existing) {
        existing.count++;
        if (existing.names.length < 8) existing.names.push(b.customerName);
      } else {
        bookedSlotMap.set(key, { start: b.start, end: b.end, count: 1, names: [b.customerName] });
      }
    }

    const availIntervals: { start: number; end: number; source: string; isPublic: boolean }[] = [];
    for (const rid of rids) {
      const mapKey = `${area.id}:${rid}`;
      const labels = areaRidLabels.get(mapKey);
      const filtered = labels ? [...labels].filter((l) => l !== area.name) : [];
      const sourceName = filtered.length > 0 ? filtered.join(", ") : "";
      const isPublic = areaRidPublic.get(mapKey) ?? false;
      for (const p of annyAvailability[rid] ?? []) {
        const s = fmtTimeBerlin(p.start);
        const e = fmtTimeBerlin(p.end);
        if (!s || !e) continue;
        const sMin = timeToMin(s);
        const eMin = timeToMin(e);
        if (sMin < eMin) availIntervals.push({ start: sMin, end: eMin, source: sourceName, isPublic });
      }
    }

    const bookedRanges: { start: number; end: number; count: number; names: string[] }[] = [];
    for (const [, b] of bookedSlotMap) {
      const sMin = timeToMin(b.start);
      const eMin = timeToMin(b.end);
      if (sMin < eMin) bookedRanges.push({ start: sMin, end: eMin, count: b.count, names: b.names });
    }

    const breakpoints = new Set<number>();
    for (const a of availIntervals) { breakpoints.add(a.start); breakpoints.add(a.end); }
    for (const b of bookedRanges) { breakpoints.add(b.start); breakpoints.add(b.end); }
    const sorted = [...breakpoints].sort((a, b) => a - b);

    const rawSlots: TimeSlot[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const segStart = sorted[i];
      const segEnd = sorted[i + 1];

      let bookCount = 0;
      const bookNames: string[] = [];
      for (const b of bookedRanges) {
        if (b.start <= segStart && b.end >= segEnd) {
          bookCount += b.count;
          bookNames.push(...b.names);
        }
      }

      if (bookCount > 0) {
        rawSlots.push({
          start: minToTime(segStart),
          end: minToTime(segEnd),
          status: "booked",
          count: bookCount,
          names: bookNames.slice(0, 8),
          capacity: area.personLimit,
        });
        continue;
      }

      const sources: string[] = [];
      let anyPublic = false;
      for (const a of availIntervals) {
        if (a.start <= segStart && a.end >= segEnd) {
          if (a.source && !sources.includes(a.source)) sources.push(a.source);
          if (a.isPublic) anyPublic = true;
        }
      }

      if (sources.length > 0 || availIntervals.some((a) => a.start <= segStart && a.end >= segEnd)) {
        rawSlots.push({
          start: minToTime(segStart),
          end: minToTime(segEnd),
          status: "free",
          count: 0,
          names: [],
          capacity: area.personLimit,
          source: sources.join(", "),
          isPublic: anyPublic,
        });
      }
    }

    const slots: TimeSlot[] = [];
    for (const slot of rawSlots) {
      const prev = slots[slots.length - 1];
      if (
        prev &&
        prev.end === slot.start &&
        prev.status === slot.status &&
        prev.source === slot.source &&
        prev.isPublic === slot.isPublic &&
        (slot.status === "free" ||
          (slot.status === "booked" && prev.count === slot.count &&
            prev.names.join(",") === slot.names.join(",")))
      ) {
        prev.end = slot.end;
      } else {
        slots.push({ ...slot });
      }
    }

    const totalBooked = [...bookedSlotMap.values()].reduce((sum, s) => sum + s.count, 0);

    return {
      id: area.id,
      name: area.name,
      capacity: area.personLimit,
      totalBooked,
      slots,
    };
  });

  const debugMode = url.searchParams.get("debug") === "1";

  const response: Record<string, unknown> = {
    name: config.name,
    date: dateStr,
    now: now.toISOString(),
    resources,
  };

  if (debugMode && baseUrl && annyConfig?.token) {
    const allRids = [...new Set(Object.values(resourceIds))];
    const debugAreaRids: Record<string, string[]> = {};
    for (const [areaId, rids] of areaAnnyIds) {
      const area = areas.find((a) => a.id === areaId);
      debugAreaRids[`${areaId} (${area?.name ?? "?"})`] = rids;
    }

    const testRids = allRids.slice(0, 5);
    const slotsParams = new URLSearchParams({
      start_date: `${dateStr}T00:00:00+01:00`,
      end_date: `${dateStr}T23:59:59+01:00`,
      timezone: "Europe/Berlin",
    });
    for (const id of testRids) slotsParams.append("r[]", id);

    let slotsRaw: unknown = null;
    let periodsRaw: unknown = null;
    const resourceDetails: Record<string, unknown> = {};

    try {
      const headers = { Authorization: `Bearer ${annyConfig.token}`, Accept: "application/json" };
      const [slotsRes, periodsRes] = await Promise.all([
        fetch(`${baseUrl}/api/v1/availability/slots?${slotsParams}`, { headers, signal: AbortSignal.timeout(8000) }),
        fetch(`${baseUrl}/api/v1/availability/periods?${slotsParams}`, { headers, signal: AbortSignal.timeout(8000) }),
      ]);
      if (slotsRes.ok) slotsRaw = await slotsRes.json();
      else slotsRaw = { _error: slotsRes.status, _statusText: slotsRes.statusText };
      if (periodsRes.ok) periodsRaw = await periodsRes.json();
      else periodsRaw = { _error: periodsRes.status };

      for (const rid of testRids.slice(0, 3)) {
        try {
          const r = await fetch(`${baseUrl}/api/v1/resources/${rid}`, { headers, signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const rj = await r.json();
            const d = rj?.data?.attributes || rj?.data || rj;
            resourceDetails[rid] = {
              name: d?.name,
              slot_duration: d?.slot_duration,
              slot_interval: d?.slot_interval,
              booking_interval: d?.booking_interval,
              duration: d?.duration,
              min_duration: d?.min_duration,
              max_duration: d?.max_duration,
              buffer_time: d?.buffer_time,
            };
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    response._debug = {
      allRids,
      areaAnnyIds: debugAreaRids,
      availabilityKeys: Object.keys(annyAvailability),
      availabilityCounts: Object.fromEntries(
        Object.entries(annyAvailability).map(([k, v]) => [k, v.length]),
      ),
      areaRidLabels: Object.fromEntries(
        [...areaRidLabels].map(([k, v]) => [k, [...v]]),
      ),
      bookingsCount: allBookings.length,
      _slotsEndpoint: slotsRaw,
      _periodsEndpoint: periodsRaw,
      _resourceDetails: resourceDetails,
    };
  }

  return NextResponse.json(response);
}
