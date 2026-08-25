import { addCalendarDays, berlinDayRange, berlinHour, berlinYmd } from "@/lib/berlin-day";
import { scanDenyReasonLabel } from "@/lib/scan-deny-reason";

/**
 * Tagesauswertung eines Drehkreuz-Bereichs.
 *
 * Bewusst nicht ueber Ticket-Gueltigkeiten: Stundenkarten (DURATION ohne
 * `endDate`) bleiben kalendarisch dauerhaft "gueltig" – an Seilbahn A zaehlt
 * das Dashboard ueber 1.000 Tickets, obwohl nur ein Bruchteil faehrt.
 * Aussagekraeftig ist der Drehkreuz-Durchgang:
 *
 *   - Fahrten  = GRANTED-Scans (jede Bergfahrt einzeln)
 *   - Gaeste   = eindeutige Tickets mit GRANTED-Scan
 *   - Tickets  = am Tag fuer den Bereich angelegte Tickets (vom Aufrufer)
 */

export type TurnstileScanResult = "GRANTED" | "DENIED" | "PROTECTED" | string;

export interface TurnstileDayScan {
  result: TurnstileScanResult;
  note: string | null;
  scanTime: Date;
  deviceId: number | null;
  ticketId: number | null;
  ticketTypeName: string | null;
}

export interface TurnstileWeekScan {
  result: TurnstileScanResult;
  scanTime: Date;
  ticketId: number | null;
}

export interface TurnstileHourBucket {
  hour: string;
  granted: number;
  denied: number;
  total: number;
}

export interface TurnstileTrendDay {
  date: string;
  dayName: string;
  rides: number;
  denied: number;
  guests: number;
}

export interface TurnstileDeviceStat {
  granted: number;
  denied: number;
  protected: number;
  total: number;
  lastScanAt: Date | null;
}

export interface TurnstileDaySummary {
  totals: {
    scans: number;
    rides: number;
    denied: number;
    protected: number;
    guests: number;
    ridesWithoutTicket: number;
    grantRate: number;
    ridesPerGuest: number;
    soldTickets: number;
    firstScanAt: Date | null;
    lastScanAt: Date | null;
    peakHour: { hour: string; count: number } | null;
  };
  average: { rides: number; guests: number; days: number } | null;
  previousDay: { rides: number; guests: number } | null;
  hourly: TurnstileHourBucket[];
  ticketTypes: { name: string; rides: number; guests: number }[];
  denyReasons: { reason: string; count: number }[];
  weekTrend: TurnstileTrendDay[];
  deviceStats: Map<number, TurnstileDeviceStat>;
}

const DEFAULT_MAX_TICKET_TYPES = 8;
const DEFAULT_MAX_DENY_REASONS = 6;

function emptyHourly(): TurnstileHourBucket[] {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}:00`,
    granted: 0,
    denied: 0,
    total: 0,
  }));
}

export function summarizeTurnstileDay(args: {
  dateStr: string;
  dayScans: TurnstileDayScan[];
  weekScans: TurnstileWeekScan[];
  soldTickets: number;
  deviceIds?: number[];
  maxTicketTypes?: number;
  maxDenyReasons?: number;
}): TurnstileDaySummary {
  const maxTypes = args.maxTicketTypes ?? DEFAULT_MAX_TICKET_TYPES;
  const maxReasons = args.maxDenyReasons ?? DEFAULT_MAX_DENY_REASONS;
  const hourly = emptyHourly();
  const deviceStats = new Map<number, TurnstileDeviceStat>(
    (args.deviceIds ?? []).map((id) => [
      id,
      { granted: 0, denied: 0, protected: 0, total: 0, lastScanAt: null },
    ]),
  );
  const typeStats = new Map<string, { rides: number; guests: Set<number> }>();
  const denyReasons = new Map<string, number>();
  const guests = new Set<number>();

  let granted = 0;
  let denied = 0;
  let protectedCount = 0;
  let ridesWithoutTicket = 0;
  let firstScanAt: Date | null = null;
  let lastScanAt: Date | null = null;

  for (const scan of args.dayScans) {
    const bucket = hourly[berlinHour(scan.scanTime)];
    if (bucket) {
      bucket.total++;
      if (scan.result === "GRANTED") bucket.granted++;
      else if (scan.result === "DENIED") bucket.denied++;
    }

    if (scan.result === "GRANTED") {
      granted++;
      if (!firstScanAt) firstScanAt = scan.scanTime;
      lastScanAt = scan.scanTime;

      if (scan.ticketId == null) {
        ridesWithoutTicket++;
      } else {
        guests.add(scan.ticketId);
        const typeName = scan.ticketTypeName || "Ohne Ticket-Typ";
        const entry = typeStats.get(typeName) ?? { rides: 0, guests: new Set<number>() };
        entry.rides++;
        entry.guests.add(scan.ticketId);
        typeStats.set(typeName, entry);
      }
    } else {
      if (scan.result === "DENIED") denied++;
      else protectedCount++;
      const label = scanDenyReasonLabel(scan.note) ?? "Ohne Grund";
      denyReasons.set(label, (denyReasons.get(label) ?? 0) + 1);
    }

    if (scan.deviceId != null) {
      const stats = deviceStats.get(scan.deviceId) ?? {
        granted: 0,
        denied: 0,
        protected: 0,
        total: 0,
        lastScanAt: null,
      };
      stats.total++;
      if (scan.result === "GRANTED") stats.granted++;
      else if (scan.result === "DENIED") stats.denied++;
      else stats.protected++;
      stats.lastScanAt = scan.scanTime;
      deviceStats.set(scan.deviceId, stats);
    }
  }

  const peakHour = hourly.reduce<{ hour: string; count: number } | null>(
    (best, b) => (b.total > 0 && (!best || b.total > best.count) ? { hour: b.hour, count: b.total } : best),
    null,
  );

  const sortedTypes = [...typeStats.entries()]
    .map(([name, v]) => ({ name, rides: v.rides, guests: v.guests.size }))
    .sort((a, b) => b.rides - a.rides || a.name.localeCompare(b.name, "de"));
  const topTypes = sortedTypes.slice(0, maxTypes);
  const restTypes = sortedTypes.slice(maxTypes);
  const ticketTypes = restTypes.length
    ? [
        ...topTypes,
        {
          name: `Weitere (${restTypes.length})`,
          rides: restTypes.reduce((s, t) => s + t.rides, 0),
          guests: restTypes.reduce((s, t) => s + t.guests, 0),
        },
      ]
    : topTypes;

  const weekTrend = Array.from({ length: 7 }, (_, i) => {
    const ymd = addCalendarDays(args.dateStr, i - 6);
    return {
      date: ymd,
      dayName: berlinDayRange(ymd).start.toLocaleDateString("de-DE", {
        timeZone: "Europe/Berlin",
        weekday: "short",
      }),
      rides: 0,
      denied: 0,
      guests: 0,
    };
  });
  const weekIdxByDate = new Map(weekTrend.map((d, i) => [d.date, i]));
  const guestsPerDay = weekTrend.map(() => new Set<number>());
  for (const scan of args.weekScans) {
    const idx = weekIdxByDate.get(berlinYmd(scan.scanTime));
    if (idx == null) continue;
    if (scan.result === "GRANTED") {
      weekTrend[idx].rides++;
      if (scan.ticketId != null) guestsPerDay[idx].add(scan.ticketId);
    } else if (scan.result === "DENIED") {
      weekTrend[idx].denied++;
    }
  }
  weekTrend.forEach((d, i) => {
    d.guests = guestsPerDay[i].size;
  });

  // Vergleichsbasis: die sechs Tage VOR dem gewaehlten Tag.
  const previousDays = weekTrend.slice(0, 6);
  const daysWithData = previousDays.filter((d) => d.rides > 0);
  const average = daysWithData.length
    ? {
        rides: Math.round(daysWithData.reduce((s, d) => s + d.rides, 0) / daysWithData.length),
        guests: Math.round(daysWithData.reduce((s, d) => s + d.guests, 0) / daysWithData.length),
        days: daysWithData.length,
      }
    : null;

  const ticketedRides = granted - ridesWithoutTicket;

  return {
    totals: {
      scans: args.dayScans.length,
      rides: granted,
      denied,
      protected: protectedCount,
      guests: guests.size,
      ridesWithoutTicket,
      grantRate: args.dayScans.length > 0 ? Math.round((granted / args.dayScans.length) * 100) : 0,
      ridesPerGuest: guests.size > 0 ? Math.round((ticketedRides / guests.size) * 10) / 10 : 0,
      soldTickets: args.soldTickets,
      firstScanAt,
      lastScanAt,
      peakHour,
    },
    average,
    previousDay: weekTrend[5] ? { rides: weekTrend[5].rides, guests: weekTrend[5].guests } : null,
    hourly,
    ticketTypes,
    denyReasons: [...denyReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxReasons),
    weekTrend,
    deviceStats,
  };
}
