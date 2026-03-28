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
}

interface BookingEntry {
  start: string;
  end: string;
  customerName: string;
}

/**
 * Fetches ALL bookings for a day from ANNY (services + resources),
 * returns them grouped by ANNY resource ID.
 */
async function fetchAllAnnyBookingsForDay(
  baseUrl: string,
  apiToken: string,
  dateStr: string,
): Promise<Map<string, BookingEntry[]>> {
  const startDate = `${dateStr}T00:00:00+01:00`;
  const endDate = `${dateStr}T23:59:59+01:00`;
  const result = new Map<string, BookingEntry[]>();
  const cancelledStatuses = new Set(["cancelled", "canceled", "rejected", "no_show"]);
  let page = 1;
  const pageSize = 100;

  try {
    while (page <= 10) {
      const params = new URLSearchParams({
        include: "customer,resource,service",
        "filter[start_date_from]": startDate,
        "filter[start_date_to]": endDate,
        "page[size]": String(pageSize),
        "page[number]": String(page),
        sort: "start_date",
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

        const resourceId = booking.resource?.id ? String(booking.resource.id) : null;
        if (!resourceId) continue;

        if (booking.start_date) {
          try {
            const bd = new Date(booking.start_date)
              .toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
            if (bd !== dateStr) continue;
          } catch { continue; }
        }

        const cust = booking.customer;
        const customerName =
          cust?.full_name || cust?.name ||
          `${cust?.given_name || ""} ${cust?.family_name || ""}`.trim();

        if (!result.has(resourceId)) result.set(resourceId, []);
        result.get(resourceId)!.push({
          start: booking.start_date ? fmtTimeBerlin(booking.start_date) : "",
          end: booking.end_date ? fmtTimeBerlin(booking.end_date) : "",
          customerName,
        });
      }

      if (bookings.length < pageSize) break;
      page++;
    }
  } catch { /* ignore */ }

  return result;
}

export async function GET(
  _request: Request,
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
  const dateStr = berlinDate;

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
  let allAnnyBookings = new Map<string, BookingEntry[]>();
  let baseUrl = "";

  if (annyConfig?.token && annyConfig.extraConfig) {
    try {
      const parsed: AnnyMapping = JSON.parse(annyConfig.extraConfig);
      mappings = parsed.mappings ?? {};
      resourceIds = parsed.resourceIds ?? {};
      baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
      const allRids = [...new Set(Object.values(resourceIds))];

      if (allRids.length > 0) {
        const [avail, bookings] = await Promise.all([
          fetchAnnyAvailability(baseUrl, annyConfig.token, allRids, dateStr),
          fetchAllAnnyBookingsForDay(baseUrl, annyConfig.token, dateStr),
        ]);
        annyAvailability = avail;
        allAnnyBookings = bookings;
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

  const resources = areas.map((area) => {
    const rids = areaAnnyIds.get(area.id) ?? [];

    const bookedSlotMap = new Map<string, { start: string; end: string; count: number; names: string[] }>();
    for (const rid of rids) {
      for (const b of allAnnyBookings.get(rid) ?? []) {
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
    }

    const freeSlots: { start: string; end: string }[] = [];
    for (const rid of rids) {
      for (const p of annyAvailability[rid] ?? []) {
        const s = fmtTimeBerlin(p.start);
        const e = fmtTimeBerlin(p.end);
        if (!s || !e) continue;
        const key = `${s}-${e}`;
        if (!bookedSlotMap.has(key) && !freeSlots.some((f) => f.start === s && f.end === e)) {
          freeSlots.push({ start: s, end: e });
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

    for (const free of freeSlots) {
      slots.push({
        start: free.start,
        end: free.end,
        status: "free",
        count: 0,
        names: [],
        capacity: area.personLimit,
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
