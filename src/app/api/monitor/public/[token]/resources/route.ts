import { NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import { fetchAnnyAvailability, fmtTimeBerlin, berlinOffset } from "@/lib/anny-availability";
import { normalizeAnnyBookingsResponse } from "@/lib/anny-jsonapi";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { createTtlCache } from "@/lib/ttl-cache";
import { hideMonitorNames } from "@/lib/link-rules";
import { loadLinkRules } from "@/lib/link-rules-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Die Auslastungsanzeige fragt einmal pro Minute ab (dazu Tageswechsel per
 * Hand). Jeder Abruf geht an ANNY; die Grenze reicht fuer viele Anzeigen mit
 * demselben Link hinter einer IP.
 */
const RESOURCES_LIMIT = { limit: 120, windowMs: 60_000 } as const;

interface TimeSlot {
  start: string;
  end: string;
  status: "free" | "booked";
  count: number;
  names: string[];
  capacity: number | null;
  source?: string;
  isPublic?: boolean;
  price?: string;
  checkins?: number;
}

interface BookingEntry {
  start: string;
  end: string;
  customerName: string;
  resourceId: string | null;
  resourceName: string | null;
  serviceName: string | null;
}

/** Ein Abruf, der unterwegs abbrach: Teilergebnis zurueckgeben, aber nicht
 *  zwischenspeichern, damit der naechste Poll es erneut versucht. */
class PartialBookingsError extends Error {
  constructor(readonly entries: BookingEntry[]) {
    super("ANNY-Buchungen unvollständig");
  }
}

/** Buchungen je Mandant und Tag rund 60 Sekunden halten: der Monitor pollt
 *  jede Minute, mehrere Anzeigen desselben Mandanten teilen sich den Abruf. */
const BOOKINGS_TTL_MS = 60 * 1000;
const bookingsCache = createTtlCache<BookingEntry[]>(BOOKINGS_TTL_MS);

async function fetchAllAnnyBookingsForDay(
  accountId: number,
  baseUrl: string,
  apiToken: string,
  dateStr: string,
): Promise<BookingEntry[]> {
  try {
    return await bookingsCache.get(`${accountId}|${baseUrl}|${dateStr}`, async () => {
      const { entries, complete } = await loadAnnyBookingsForDay(baseUrl, apiToken, dateStr);
      if (!complete) throw new PartialBookingsError(entries);
      return entries;
    });
  } catch (err) {
    return err instanceof PartialBookingsError ? err.entries : [];
  }
}

async function loadAnnyBookingsForDay(
  baseUrl: string,
  apiToken: string,
  dateStr: string,
): Promise<{ entries: BookingEntry[]; complete: boolean }> {
  const result: BookingEntry[] = [];
  const cancelledStatuses = new Set(["cancelled", "canceled", "rejected", "no_show"]);
  let page = 1;
  const pageSize = 100;
  let complete = false;

  // ANNY filtert serverseitig auf den Buchungsbeginn (Format Y-m-d:Y-m-d wie im
  // stuendlichen Sync). `start_date` kommt in UTC, deshalb Vor- und Folgetag
  // mit abfragen und unten lokal auf den Berliner Tag einschraenken.
  const dayMs = 86400000;
  const middayMs = new Date(`${dateStr}T12:00:00Z`).getTime();
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const startDateRange = `${ymd(middayMs - dayMs)}:${ymd(middayMs + dayMs)}`;

  try {
    while (page <= 20) {
      const params = new URLSearchParams({
        include: "customer,resource,service",
        "filter[start_date_range]": startDateRange,
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

      if (bookings.length < pageSize) {
        complete = true;
        break;
      }
      page++;
    }
  } catch { /* ignore */ }

  return { entries: result, complete };
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-resources", RESOURCES_LIMIT);
  if (limited) return limited;

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

  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const selectedAreaIds = (config.deviceIds as number[]) ?? [];

  const [areas, annyConfig, allLinks, linkRules] = await Promise.all([
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
      select: { token: true, baseUrl: true },
    }),
    db.annyResourceLink.findMany({
      where: {
        accountId,
        ...(selectedAreaIds.length > 0 ? { accessAreaId: { in: selectedAreaIds } } : {}),
      },
    }),
    // Regel „Kundennamen am Auslastungs-Monitor ausblenden“ (60 s im Speicher).
    loadLinkRules(prisma, accountId),
  ]);

  const areaLinks = new Map<number, typeof allLinks>();
  for (const link of allLinks) {
    if (!areaLinks.has(link.accessAreaId)) areaLinks.set(link.accessAreaId, []);
    areaLinks.get(link.accessAreaId)!.push(link);
  }

  const allRids = [...new Set(allLinks.map((l) => l.annyResourceId))];

  let annyAvailability: Record<string, { start: string; end: string }[]> = {};
  let allBookings: BookingEntry[] = [];
  let baseUrl = "";

  if (annyConfig?.token && allRids.length > 0) {
    baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
    const [avail, bookings] = await Promise.all([
      fetchAnnyAvailability(baseUrl, annyConfig.token, allRids, dateStr),
      fetchAllAnnyBookingsForDay(accountId, baseUrl, annyConfig.token, dateStr),
    ]);
    annyAvailability = avail;
    allBookings = bookings;
  }

  const tz = berlinOffset(dateStr);
  const dayStart = new Date(`${dateStr}T00:00:00${tz}`);
  const dayEnd = new Date(`${dateStr}T23:59:59${tz}`);

  const areaIds = areas.map((a) => a.id);
  const checkinScans = areaIds.length > 0
    ? await db.scan.findMany({
        where: {
          accountId,
          scanTime: { gte: dayStart, lte: dayEnd },
          result: "GRANTED",
          ticket: {
            subscriptionId: { not: null },
            status: { in: ["VALID", "REDEEMED"] },
            OR: [
              { accessAreaId: { in: areaIds } },
              { ticketAreas: { some: { accessAreaId: { in: areaIds } } } },
            ],
          },
        },
        select: {
          scanTime: true,
          ticket: {
            select: {
              accessAreaId: true,
              ticketAreas: { select: { accessAreaId: true } },
            },
          },
        },
      })
    : [];

  const checkinsByArea = new Map<number, string[]>();
  for (const scan of checkinScans) {
    const scanMin = fmtTimeBerlin(scan.scanTime.toISOString());
    const ticketAreaIds = new Set<number>();
    if (scan.ticket?.accessAreaId) ticketAreaIds.add(scan.ticket.accessAreaId);
    for (const ta of scan.ticket?.ticketAreas ?? []) ticketAreaIds.add(ta.accessAreaId);
    for (const aid of ticketAreaIds) {
      if (!checkinsByArea.has(aid)) checkinsByArea.set(aid, []);
      checkinsByArea.get(aid)!.push(scanMin);
    }
  }

  const allCheckinScans = areaIds.length > 0
    ? await db.scan.findMany({
        where: {
          accountId,
          scanTime: { gte: dayStart, lte: dayEnd },
          result: "GRANTED",
          ticket: {
            subscriptionId: null,
            status: { in: ["VALID", "REDEEMED"] },
            OR: [
              { accessAreaId: { in: areaIds } },
              { ticketAreas: { some: { accessAreaId: { in: areaIds } } } },
            ],
          },
        },
        select: {
          ticket: {
            select: {
              accessAreaId: true,
              ticketAreas: { select: { accessAreaId: true } },
            },
          },
        },
      })
    : [];

  const ticketCheckinsByArea = new Map<number, number>();
  for (const scan of allCheckinScans) {
    const aids = new Set<number>();
    if (scan.ticket?.accessAreaId) aids.add(scan.ticket.accessAreaId);
    for (const ta of scan.ticket?.ticketAreas ?? []) aids.add(ta.accessAreaId);
    for (const aid of aids) {
      ticketCheckinsByArea.set(aid, (ticketCheckinsByArea.get(aid) ?? 0) + 1);
    }
  }

  const resources = areas.map((area) => {
    const links = areaLinks.get(area.id) ?? [];
    const rids = [...new Set(links.map((l) => l.annyResourceId))];

    const hasSubResources = links.some((l) => l.label !== area.name);

    const areaAnnyNames = new Set(links.map((l) => l.annyName));
    const bookedSlotMap = new Map<string, { start: string; end: string; count: number; names: string[] }>();
    for (const b of allBookings) {
      const matchByRid = b.resourceId != null && rids.includes(b.resourceId);
      const ridIsKnown = b.resourceId != null && allRids.includes(b.resourceId);
      const matchByResName = !ridIsKnown && b.resourceName != null && areaAnnyNames.has(b.resourceName);
      const matchBySvcName = !ridIsKnown && b.serviceName != null && areaAnnyNames.has(b.serviceName);
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

    interface AvailInterval {
      start: number;
      end: number;
      source: string;
      isPublic: boolean;
      splitSlots: boolean;
      interval: number;
      price: string;
    }

    const ridLabels = new Map<string, { labels: Set<string>; isPublic: boolean; splitSlots: boolean; interval: number; price: string }>();
    for (const link of links) {
      const label = hasSubResources && link.label === area.name ? null : link.label;
      if (!label) continue;

      const linkPrice = (isWeekend && link.priceLabelWeekend) || link.priceLabel || "";

      if (!ridLabels.has(link.annyResourceId)) {
        ridLabels.set(link.annyResourceId, {
          labels: new Set(),
          isPublic: link.isPublic,
          splitSlots: link.splitSlots,
          interval: link.bookingInterval ?? (link.splitSlots ? 60 : 0),
          price: linkPrice,
        });
      }
      const entry = ridLabels.get(link.annyResourceId)!;
      entry.labels.add(label);
      if (link.isPublic) entry.isPublic = true;
      if (!link.splitSlots) entry.splitSlots = false;
      if (link.bookingInterval && (entry.interval === 0 || link.bookingInterval < entry.interval)) {
        entry.interval = link.bookingInterval;
        if (linkPrice) entry.price = linkPrice;
      }
    }

    const availIntervals: AvailInterval[] = [];
    for (const [rid, info] of ridLabels) {
      const labelsArr = [...info.labels];
      const deduped = labelsArr.filter((label) =>
        !labelsArr.some((other) => other !== label && other.startsWith(label)),
      );
      const sourceName = (deduped.length > 0 ? deduped : labelsArr).join(", ");

      for (const p of annyAvailability[rid] ?? []) {
        const s = fmtTimeBerlin(p.start);
        const e = fmtTimeBerlin(p.end);
        if (!s || !e) continue;
        const sMin = timeToMin(s);
        const eMin = timeToMin(e);
        if (sMin < eMin) {
          availIntervals.push({
            start: sMin, end: eMin, source: sourceName,
            isPublic: info.isPublic, splitSlots: info.splitSlots,
            interval: info.interval, price: info.price,
          });
        }
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
        let segPublic = false;
        const segSources: string[] = [];
        const segPrices: string[] = [];
        for (const a of availIntervals) {
          if (a.start <= segStart && a.end >= segEnd) {
            if (a.isPublic) segPublic = true;
            if (a.source && !segSources.includes(a.source)) segSources.push(a.source);
            if (a.price && !segPrices.includes(a.price)) segPrices.push(a.price);
          }
        }
        rawSlots.push({
          start: minToTime(segStart), end: minToTime(segEnd),
          status: segPublic ? "free" : "booked",
          count: bookCount, names: bookNames.slice(0, 8),
          capacity: area.personLimit,
          ...(segPublic ? { isPublic: true, source: segSources.join(", "), price: segPrices.join("\n") } : {}),
        });
        continue;
      }

      const sources: string[] = [];
      let anyPublic = false;
      let shouldSplit = false;
      let minInterval = 0;
      let splitPrice = "";
      const allPrices: string[] = [];
      for (const a of availIntervals) {
        if (a.start <= segStart && a.end >= segEnd) {
          if (a.source && !sources.includes(a.source)) sources.push(a.source);
          if (a.isPublic) anyPublic = true;
          if (a.price && !allPrices.includes(a.price)) allPrices.push(a.price);
          if (a.splitSlots && a.interval > 0) {
            shouldSplit = true;
            if (minInterval === 0 || a.interval < minInterval) {
              minInterval = a.interval;
              splitPrice = a.price;
            }
          }
        }
      }
      const slotPrice = shouldSplit ? splitPrice : allPrices.join("\n");

      if (sources.length > 0) {
        rawSlots.push({
          start: minToTime(segStart), end: minToTime(segEnd),
          status: "free", count: 0, names: [],
          capacity: area.personLimit, source: sources.join(", "),
          isPublic: anyPublic, price: slotPrice,
        });
      }
    }

    const merged: TimeSlot[] = [];
    for (const slot of rawSlots) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        prev.end === slot.start &&
        prev.status === slot.status &&
        prev.source === slot.source &&
        prev.isPublic === slot.isPublic &&
        prev.price === slot.price &&
        (slot.status === "free" && prev.count === slot.count ||
          (slot.status === "booked" && prev.count === slot.count &&
            prev.names.join(",") === slot.names.join(",")))
      ) {
        prev.end = slot.end;
      } else {
        merged.push({ ...slot });
      }
    }

    const slots: TimeSlot[] = [];
    for (const slot of merged) {
      if (slot.status !== "free") {
        slots.push(slot);
        continue;
      }

      const sMin = timeToMin(slot.start);
      const eMin = timeToMin(slot.end);
      let interval = 0;
      for (const a of availIntervals) {
        if (a.splitSlots && a.start <= sMin && a.end >= eMin && a.interval > 0) {
          interval = interval === 0 ? a.interval : Math.min(interval, a.interval);
        }
      }

      if (interval > 0 && (eMin - sMin) > interval) {
        for (let t = sMin; t < eMin; t += interval) {
          slots.push({ ...slot, start: minToTime(t), end: minToTime(Math.min(t + interval, eMin)) });
        }
      } else {
        slots.push(slot);
      }
    }

    const areaCheckins = checkinsByArea.get(area.id) ?? [];
    if (areaCheckins.length > 0) {
      for (const slot of slots) {
        const sMin = timeToMin(slot.start);
        const eMin = timeToMin(slot.end);
        let ci = 0;
        for (const scanTime of areaCheckins) {
          const m = timeToMin(scanTime);
          if (m >= sMin && m < eMin) ci++;
        }
        if (ci > 0) slot.checkins = ci;
      }
    }

    const totalBooked = [...bookedSlotMap.values()].reduce((sum, s) => sum + s.count, 0);
    const ticketCheckins = ticketCheckinsByArea.get(area.id) ?? 0;
    // Abo-Scans pro Area zaehlen (war vorher GLOBAL aufaddiert, was bei
    // vielen Areas zu massiver Doppelzaehlung gefuehrt hat - 1 Abo-Scan
    // im Aquapark wurde auch im Strandbad-Tagesplan mitgezaehlt). Die
    // checkinsByArea-Map existiert schon fuer die Slot-Anzeige.
    const aboCheckins = checkinsByArea.get(area.id)?.length ?? 0;

    return {
      id: area.id,
      name: area.name,
      capacity: area.personLimit,
      totalBooked,
      dayCheckins: aboCheckins + ticketCheckins,
      slots,
    };
  });

  return NextResponse.json({
    name: config.name,
    date: dateStr,
    now: now.toISOString(),
    // Bei eingeschalteter Regel ohne Kundennamen (`names` leer).
    resources: hideMonitorNames(linkRules, resources),
  });
}
