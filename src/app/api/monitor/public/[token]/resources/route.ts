import { NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import {
  fetchAnnyAvailability,
  fmtTimeBerlin,
  type AnnyMapping,
} from "@/lib/anny-availability";

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

async function fetchAnnyBookingsForDay(
  baseUrl: string,
  token: string,
  resourceId: string,
  dateStr: string,
): Promise<{ start: string; end: string; customerName: string; status: string }[]> {
  const startDate = `${dateStr}T00:00:00+01:00`;
  const endDate = `${dateStr}T23:59:59+01:00`;

  const params = new URLSearchParams({
    include: "customer",
    "filter[resource_id]": resourceId,
    "filter[start_date_from]": startDate,
    "filter[start_date_to]": endDate,
    "page[size]": "100",
    sort: "start_date",
  });

  try {
    const res = await fetch(`${baseUrl}/api/v1/bookings?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const json = await res.json();

    const includedMap = new Map<string, Record<string, unknown>>();
    if (Array.isArray(json.included)) {
      for (const inc of json.included) {
        if (inc.id && inc.type) includedMap.set(`${inc.type}:${inc.id}`, inc);
      }
    }

    const data = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
    const results: { start: string; end: string; customerName: string; status: string }[] = [];

    for (const item of data) {
      const attrs = item.attributes ?? item;
      const bookingStart = attrs.start_date || attrs.starts_at || "";
      const bookingEnd = attrs.end_date || attrs.ends_at || "";
      const status = (attrs.status || "").toLowerCase();

      if (["cancelled", "canceled", "rejected", "no_show"].includes(status)) continue;

      let customerName = "";
      const custRel = item.relationships?.customer?.data;
      if (custRel?.id && custRel?.type) {
        const cust = includedMap.get(`${custRel.type}:${custRel.id}`);
        if (cust) {
          const ca = (cust as Record<string, unknown>).attributes as Record<string, string> | undefined;
          customerName = ca?.full_name || ca?.name || `${ca?.given_name || ""} ${ca?.family_name || ""}`.trim();
        }
      }
      if (!customerName) {
        customerName = attrs.customer?.full_name || attrs.customer?.name || "";
      }

      results.push({
        start: bookingStart ? fmtTimeBerlin(bookingStart) : "",
        end: bookingEnd ? fmtTimeBerlin(bookingEnd) : "",
        customerName,
        status,
      });
    }
    return results;
  } catch {
    return [];
  }
}

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
  let annyBookings: Record<string, Awaited<ReturnType<typeof fetchAnnyBookingsForDay>>> = {};
  let baseUrl = "";

  if (annyConfig?.token && annyConfig.extraConfig) {
    try {
      const parsed: AnnyMapping = JSON.parse(annyConfig.extraConfig);
      mappings = parsed.mappings ?? {};
      resourceIds = parsed.resourceIds ?? {};
      baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
      const allRids = [...new Set(Object.values(resourceIds))];

      if (allRids.length > 0) {
        const [avail, ...bookingResults] = await Promise.all([
          fetchAnnyAvailability(baseUrl, annyConfig.token, allRids, dateStr),
          ...allRids.map((rid) =>
            fetchAnnyBookingsForDay(baseUrl, annyConfig.token, rid, dateStr)
              .then((b) => ({ rid, bookings: b }))
          ),
        ]);
        annyAvailability = avail;
        for (const br of bookingResults) {
          annyBookings[br.rid] = br.bookings;
        }
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
      for (const b of annyBookings[rid] ?? []) {
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
    date: dateStr,
    now: now.toISOString(),
    resources,
  });
}
