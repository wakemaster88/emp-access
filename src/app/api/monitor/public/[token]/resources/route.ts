import { NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import {
  fetchAnnyAvailabilityWithSlots,
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
          ? fetchAnnyAvailabilityWithSlots(baseUrl, annyConfig.token, allRids, dateStr)
          : Promise.resolve({} as Record<string, { start: string; end: string }[]>),
        fetchAllAnnyBookingsForDay(baseUrl, annyConfig.token, dateStr),
      ]);
      annyAvailability = avail;
      allBookings = bookings;
    } catch { /* ignore */ }
  }

  const areaAnnyIds = new Map<number, string[]>();
  const ridToName = new Map<string, string>();
  for (const [name, areaId] of Object.entries(mappings)) {
    const rid = resourceIds[name];
    if (!rid) continue;
    ridToName.set(rid, name);
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
      const sourceName = ridToName.get(rid) || "";
      const isPublic = /öffentlich/i.test(sourceName);
      for (const p of annyAvailability[rid] ?? []) {
        const s = fmtTimeBerlin(p.start);
        const e = fmtTimeBerlin(p.end);
        if (!s || !e) continue;
        const sMin = timeToMin(s);
        const eMin = timeToMin(e);
        if (sMin < eMin) availIntervals.push({ start: sMin, end: eMin, source: sourceName, isPublic });
      }
    }

    const bookedIntervals: { start: number; end: number }[] = [];
    for (const [, b] of bookedSlotMap) {
      const sMin = timeToMin(b.start);
      const eMin = timeToMin(b.end);
      if (sMin < eMin) bookedIntervals.push({ start: sMin, end: eMin });
    }

    const publicAvail = availIntervals.filter((a) => a.isPublic);
    const privateAvail = availIntervals.filter((a) => !a.isPublic);

    const publicIntervals: { start: number; end: number }[] = [];
    for (const a of publicAvail) publicIntervals.push({ start: a.start, end: a.end });

    const freeIntervals: { start: number; end: number; source: string; isPublic: boolean }[] = [];
    const seenFree = new Set<string>();

    for (const avail of publicAvail) {
      const remaining = subtractIntervals([{ start: avail.start, end: avail.end }], bookedIntervals);
      for (const f of remaining) {
        const key = `${f.start}-${f.end}-pub`;
        if (!seenFree.has(key)) {
          seenFree.add(key);
          freeIntervals.push({ ...f, source: avail.source, isPublic: true });
        }
      }
    }

    for (const avail of privateAvail) {
      const afterBookings = subtractIntervals([{ start: avail.start, end: avail.end }], bookedIntervals);
      const afterPublic = subtractIntervals(afterBookings, publicIntervals);
      for (const f of afterPublic) {
        const key = `${f.start}-${f.end}-prv`;
        if (!seenFree.has(key)) {
          seenFree.add(key);
          freeIntervals.push({ ...f, source: avail.source, isPublic: false });
        }
      }
    }

    const slots: TimeSlot[] = [];

    for (const [, booked] of bookedSlotMap) {
      slots.push({
        start: booked.start,
        end: booked.end,
        status: "booked",
        count: booked.count,
        names: booked.names,
        capacity: area.personLimit,
      });
    }

    for (const f of freeIntervals) {
      const label = f.source.replace(/^.*?\s*-\s*/, "");
      slots.push({
        start: minToTime(f.start),
        end: minToTime(f.end),
        status: "free",
        count: 0,
        names: [],
        capacity: area.personLimit,
        source: label,
        isPublic: f.isPublic,
      });
    }

    slots.sort((a, b) => a.start.localeCompare(b.start));

    const totalBooked = [...bookedSlotMap.values()].reduce((sum, s) => sum + s.count, 0);

    return {
      id: area.id,
      name: area.name,
      capacity: area.personLimit,
      totalBooked,
      slots,
    };
  });

  return NextResponse.json({
    name: config.name,
    date: dateStr,
    now: now.toISOString(),
    resources,
  });
}
