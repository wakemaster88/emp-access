import { Prisma, type PrismaClient } from "@prisma/client";
import type { RateScanCount } from "@/lib/turnstile-rate";
import type { TurnstileWeekCount } from "@/lib/turnstile-stats";

/**
 * Zaehlungen fuer Dashboard und Auswertungen direkt in der Datenbank, damit
 * nicht jede Scan-Zeile in die Function geladen werden muss.
 *
 * Rohe Abfragen laufen am Mandanten-Filter des Clients vorbei; deshalb steht
 * der Filter hier ausdruecklich. `accountId = null` heisst: kein Filter, wie
 * beim Super-Admin (`where = {}`) in den aufrufenden Routen.
 *
 * Zeitstempel liegen als `timestamp` ohne Zone in UTC. Berliner Tage und
 * Stunden entstehen ueber `AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin'`.
 */

/** Mandanten-Filter fuer eine Spalte, z. B. `"accountId"` oder `s."accountId"`. */
export function accountSql(accountId: number | null, column = `"accountId"`): Prisma.Sql {
  return accountId == null ? Prisma.sql`TRUE` : Prisma.sql`${Prisma.raw(column)} = ${accountId}`;
}

/**
 * Scans ab `dayStart` je Geraet und Ergebnis: ohne Obergrenze und bis
 * einschliesslich `now`, jeweils gesamt, letzte 60 und letzte 15 Minuten.
 */
export async function loadDayScanCounts(
  db: PrismaClient,
  accountId: number | null,
  dayStart: Date,
  now: Date,
): Promise<RateScanCount[]> {
  const t60 = new Date(now.getTime() - 60 * 60_000);
  const t15 = new Date(now.getTime() - 15 * 60_000);
  const rows = await db.$queryRaw<
    Array<{
      deviceId: number | null;
      result: string;
      total: number;
      total60: number;
      total15: number;
      upToNow: number;
      upToNow60: number;
      upToNow15: number;
      lastUpToNow: Date | null;
    }>
  >`
    SELECT
      "deviceId",
      "result"::text AS "result",
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE "scanTime" >= ${t60})::int AS "total60",
      COUNT(*) FILTER (WHERE "scanTime" >= ${t15})::int AS "total15",
      COUNT(*) FILTER (WHERE "scanTime" <= ${now})::int AS "upToNow",
      COUNT(*) FILTER (WHERE "scanTime" >= ${t60} AND "scanTime" <= ${now})::int AS "upToNow60",
      COUNT(*) FILTER (WHERE "scanTime" >= ${t15} AND "scanTime" <= ${now})::int AS "upToNow15",
      MAX("scanTime") FILTER (WHERE "scanTime" <= ${now}) AS "lastUpToNow"
    FROM "Scan"
    WHERE ${accountSql(accountId)} AND "scanTime" >= ${dayStart}
    GROUP BY "deviceId", "result"
  `;
  return rows.map((r) => ({
    deviceId: r.deviceId == null ? null : Number(r.deviceId),
    result: r.result,
    total: Number(r.total),
    total60: Number(r.total60),
    total15: Number(r.total15),
    upToNow: Number(r.upToNow),
    upToNow60: Number(r.upToNow60),
    upToNow15: Number(r.upToNow15),
    lastUpToNow: r.lastUpToNow,
  }));
}

export interface SightingCounts {
  persons: { today: number; known: number; blocked: number; unknown: number; last60: number };
  vehicles: { today: number; matched: number; unmatched: number; delivery: number; noParking: number; last60: number };
}

/**
 * Personen- und Fahrzeug-Sichtungen ab `dayStart`, gezaehlt wie bisher in
 * der Live-Lage: Hausverbot vor Zuordnung; Halteverbot zaehlt nur dort;
 * Lieferdienst (Marke nicht leer) vor Zuordnung.
 */
export async function loadSightingCounts(
  db: PrismaClient,
  accountId: number | null,
  dayStart: Date,
  hourAgo: Date,
): Promise<SightingCounts> {
  const [personRows, vehicleRows] = await Promise.all([
    db.$queryRaw<Array<Record<keyof SightingCounts["persons"], number>>>`
      SELECT
        COUNT(*)::int AS "today",
        COUNT(*) FILTER (WHERE "listType" IS NOT DISTINCT FROM 'BLACKLIST')::int AS "blocked",
        COUNT(*) FILTER (WHERE "listType" IS DISTINCT FROM 'BLACKLIST' AND "matched")::int AS "known",
        COUNT(*) FILTER (WHERE "listType" IS DISTINCT FROM 'BLACKLIST' AND NOT "matched")::int AS "unknown",
        COUNT(*) FILTER (WHERE "seenAt" >= ${hourAgo})::int AS "last60"
      FROM "PersonSighting"
      WHERE ${accountSql(accountId)} AND "seenAt" >= ${dayStart}
    `,
    db.$queryRaw<Array<Record<keyof SightingCounts["vehicles"], number>>>`
      SELECT
        COUNT(*) FILTER (WHERE "source" IS DISTINCT FROM 'NO_PARKING')::int AS "today",
        COUNT(*) FILTER (WHERE "source" IS NOT DISTINCT FROM 'NO_PARKING')::int AS "noParking",
        COUNT(*) FILTER (
          WHERE "source" IS DISTINCT FROM 'NO_PARKING' AND COALESCE("deliveryBrand", '') <> ''
        )::int AS "delivery",
        COUNT(*) FILTER (
          WHERE "source" IS DISTINCT FROM 'NO_PARKING' AND COALESCE("deliveryBrand", '') = '' AND "matched"
        )::int AS "matched",
        COUNT(*) FILTER (
          WHERE "source" IS DISTINCT FROM 'NO_PARKING' AND COALESCE("deliveryBrand", '') = '' AND NOT "matched"
        )::int AS "unmatched",
        COUNT(*) FILTER (WHERE "source" IS DISTINCT FROM 'NO_PARKING' AND "seenAt" >= ${hourAgo})::int AS "last60"
      FROM "VehicleSighting"
      WHERE ${accountSql(accountId)} AND "seenAt" >= ${dayStart}
    `,
  ]);
  const p = personRows[0];
  const v = vehicleRows[0];
  return {
    persons: {
      today: Number(p?.today ?? 0),
      known: Number(p?.known ?? 0),
      blocked: Number(p?.blocked ?? 0),
      unknown: Number(p?.unknown ?? 0),
      last60: Number(p?.last60 ?? 0),
    },
    vehicles: {
      today: Number(v?.today ?? 0),
      matched: Number(v?.matched ?? 0),
      unmatched: Number(v?.unmatched ?? 0),
      delivery: Number(v?.delivery ?? 0),
      noParking: Number(v?.noParking ?? 0),
      last60: Number(v?.last60 ?? 0),
    },
  };
}

/**
 * Sieben-Tage-Verlauf eines Bereichs: je Berliner Kalendertag Fahrten
 * (GRANTED), Ablehnungen (DENIED) und Gaeste (verschiedene Tickets mit
 * GRANTED) an den Eingangsgeraeten, Zeitraum [start, endExclusive).
 */
export async function loadAreaWeekCounts(
  db: PrismaClient,
  accountId: number | null,
  deviceIds: number[],
  start: Date,
  endExclusive: Date,
): Promise<Map<string, TurnstileWeekCount>> {
  const out = new Map<string, TurnstileWeekCount>();
  if (deviceIds.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ day: string; rides: number; denied: number; guests: number }>>`
    SELECT
      to_char(("scanTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS "day",
      COUNT(*) FILTER (WHERE "result" = 'GRANTED')::int AS "rides",
      COUNT(*) FILTER (WHERE "result" = 'DENIED')::int AS "denied",
      COUNT(DISTINCT "ticketId") FILTER (WHERE "result" = 'GRANTED')::int AS "guests"
    FROM "Scan"
    WHERE ${accountSql(accountId)}
      AND "deviceId" IN (${Prisma.join(deviceIds)})
      AND "scanTime" >= ${start}
      AND "scanTime" < ${endExclusive}
    GROUP BY 1
  `;
  for (const r of rows) {
    out.set(r.day, { rides: Number(r.rides), denied: Number(r.denied), guests: Number(r.guests) });
  }
  return out;
}

// ─── Auswertungen (/api/analytics) ──────────────────────────────────────────

/** Scans einer UTC-Stunde und eines Ergebnisses. */
export interface HourResultCount {
  /** Beginn der UTC-Stunde. */
  hour: Date;
  result: string;
  count: number;
}

/** Scans je Geraet und Ergebnis, mit dem fruehesten Scan (fuer die Reihenfolge). */
export interface DeviceResultCount {
  deviceId: number | null;
  result: string;
  count: number;
  firstAt: Date;
}

/** Name und Zaehlung, mit dem fruehesten Scan der Gruppe. */
export interface NamedCount {
  name: string;
  count: number;
  firstAt: Date;
}

/**
 * Ticket-Gruppe fuer die Auswertung: gleicher Status, gleiche Quelle, gleiche
 * Namen von Service, Abo und Bereich. `firstId` ist die kleinste Ticket-ID.
 */
export interface TicketGroupCount {
  status: string;
  source: string | null;
  serviceName: string | null;
  subscriptionName: string | null;
  areaName: string | null;
  count: number;
  firstId: number;
}

/** Ticket ueberschneidet [rangeStart, rangeEnd] (offene Enden zaehlen als offen). */
function ticketOverlapSql(alias: string, rangeStart: Date, rangeEnd: Date): Prisma.Sql {
  const start = Prisma.raw(`${alias}."startDate"`);
  const end = Prisma.raw(`${alias}."endDate"`);
  return Prisma.sql`(${start} IS NULL OR ${start} <= ${rangeEnd}) AND (${end} IS NULL OR ${end} >= ${rangeStart})`;
}

/**
 * Alles, was `/api/analytics` aus den Scans und Tickets eines Zeitraums
 * [rangeStart, rangeEnd] (beide Enden einschliesslich) braucht.
 */
export async function loadAnalyticsCounts(
  db: PrismaClient,
  accountId: number | null,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{
  hours: HourResultCount[];
  devices: DeviceResultCount[];
  uniqueTickets: number;
  areas: NamedCount[];
  tickets: TicketGroupCount[];
}> {
  const scanWhere = Prisma.sql`${accountSql(accountId, `s."accountId"`)}
    AND s."scanTime" >= ${rangeStart} AND s."scanTime" <= ${rangeEnd}`;
  const [hourRows, deviceRows, uniqueRows, areaRows, ticketRows] = await Promise.all([
    db.$queryRaw<Array<{ hour: Date; result: string; count: number }>>`
      SELECT date_trunc('hour', s."scanTime") AS "hour", s."result"::text AS "result", COUNT(*)::int AS "count"
      FROM "Scan" s
      WHERE ${scanWhere}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
    db.$queryRaw<Array<{ deviceId: number | null; result: string; count: number; firstAt: Date }>>`
      SELECT s."deviceId", s."result"::text AS "result", COUNT(*)::int AS "count", MIN(s."scanTime") AS "firstAt"
      FROM "Scan" s
      WHERE ${scanWhere}
      GROUP BY 1, 2
    `,
    db.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT s."ticketId")::int AS "n"
      FROM "Scan" s
      WHERE ${scanWhere}
    `,
    // Scans je Bereich des Tickets; nur Tickets, die den Zeitraum ueberschneiden.
    db.$queryRaw<Array<{ name: string; count: number; firstAt: Date }>>`
      SELECT a."name", COUNT(*)::int AS "count", MIN(s."scanTime") AS "firstAt"
      FROM "Scan" s
      JOIN "Ticket" t ON t."id" = s."ticketId"
      JOIN "AccessArea" a ON a."id" = t."accessAreaId"
      WHERE ${scanWhere}
        AND ${accountSql(accountId, `t."accountId"`)}
        AND ${ticketOverlapSql("t", rangeStart, rangeEnd)}
      GROUP BY a."name"
    `,
    db.$queryRaw<
      Array<{
        status: string;
        source: string | null;
        serviceName: string | null;
        subscriptionName: string | null;
        areaName: string | null;
        count: number;
        firstId: number;
      }>
    >`
      SELECT
        t."status"::text AS "status",
        t."source"::text AS "source",
        sv."name" AS "serviceName",
        sb."name" AS "subscriptionName",
        a."name" AS "areaName",
        COUNT(*)::int AS "count",
        MIN(t."id")::int AS "firstId"
      FROM "Ticket" t
      LEFT JOIN "Service" sv ON sv."id" = t."serviceId"
      LEFT JOIN "Subscription" sb ON sb."id" = t."subscriptionId"
      LEFT JOIN "AccessArea" a ON a."id" = t."accessAreaId"
      WHERE ${accountSql(accountId, `t."accountId"`)}
        AND ${ticketOverlapSql("t", rangeStart, rangeEnd)}
      GROUP BY 1, 2, 3, 4, 5
    `,
  ]);
  return {
    hours: hourRows.map((r) => ({ hour: r.hour, result: r.result, count: Number(r.count) })),
    devices: deviceRows.map((r) => ({
      deviceId: r.deviceId == null ? null : Number(r.deviceId),
      result: r.result,
      count: Number(r.count),
      firstAt: r.firstAt,
    })),
    uniqueTickets: Number(uniqueRows[0]?.n ?? 0),
    areas: areaRows.map((r) => ({ name: r.name, count: Number(r.count), firstAt: r.firstAt })),
    tickets: ticketRows.map((r) => ({
      status: r.status,
      source: r.source,
      serviceName: r.serviceName,
      subscriptionName: r.subscriptionName,
      areaName: r.areaName,
      count: Number(r.count),
      firstId: Number(r.firstId),
    })),
  };
}

/**
 * Geraete-Zaehlung nach Anzeigename zusammenfassen, in der Reihenfolge des
 * ersten Scans je Name (wie frueher beim Durchlauf der nach Zeit sortierten
 * Scans), danach nach Summe absteigend (stabil). Gezaehlt werden GRANTED und
 * DENIED; ein Name erscheint auch, wenn er nur andere Ergebnisse hat.
 */
export function deviceCountsByName(
  rows: DeviceResultCount[],
  nameOf: (deviceId: number | null) => string,
): { name: string; granted: number; denied: number; total: number }[] {
  const byName = new Map<string, { granted: number; denied: number; firstAt: number }>();
  for (const r of rows) {
    const name = nameOf(r.deviceId);
    const e = byName.get(name) ?? { granted: 0, denied: 0, firstAt: r.firstAt.getTime() };
    if (r.firstAt.getTime() < e.firstAt) e.firstAt = r.firstAt.getTime();
    if (r.result === "GRANTED") e.granted += r.count;
    else if (r.result === "DENIED") e.denied += r.count;
    byName.set(name, e);
  }
  return [...byName.entries()]
    .sort((a, b) => a[1].firstAt - b[1].firstAt)
    .map(([name, { granted, denied }]) => ({ name, granted, denied, total: granted + denied }))
    .sort((a, b) => b.total - a.total);
}

// ─── E-Abo-Auswertung (/api/analytics/e-abo) ────────────────────────────────

/** Scans eines Abo-Tickets im Gueltigkeitsfenster. */
export interface TicketScanCount {
  ticketId: number;
  granted: number;
  denied: number;
  /** Letzter GRANTED-Scan. */
  lastGranted: Date | null;
}

/**
 * Scans der Abo-Tickets (Ticket mit Abo, optional genau dieses Abo), die im
 * Gueltigkeitsfenster ihres Tickets liegen: Beginn/Ende des Tickets, sonst
 * des Abos, beide Enden einschliesslich, offene Enden offen. Dazu die
 * Grenzen `scanFrom`/`scanTo` fuer alle Tickets (wie bisher in der Route).
 */
export async function loadAboScanCounts(
  db: PrismaClient,
  accountId: number | null,
  subscriptionId: number | null,
  scanFrom: Date | null,
  scanTo: Date | null,
): Promise<{ tickets: TicketScanCount[]; hours: HourResultCount[]; devices: DeviceResultCount[] }> {
  const where = Prisma.sql`${accountSql(accountId, `s."accountId"`)}
    AND ${accountSql(accountId, `t."accountId"`)}
    AND t."subscriptionId" IS NOT NULL
    AND ${subscriptionId != null ? Prisma.sql`t."subscriptionId" = ${subscriptionId}` : Prisma.sql`TRUE`}
    AND ${scanFrom ? Prisma.sql`s."scanTime" >= ${scanFrom}` : Prisma.sql`TRUE`}
    AND ${scanTo ? Prisma.sql`s."scanTime" <= ${scanTo}` : Prisma.sql`TRUE`}
    AND (COALESCE(t."startDate", sb."defaultStartDate") IS NULL
         OR s."scanTime" >= COALESCE(t."startDate", sb."defaultStartDate"))
    AND (COALESCE(t."endDate", sb."defaultEndDate") IS NULL
         OR s."scanTime" <= COALESCE(t."endDate", sb."defaultEndDate"))`;
  const from = Prisma.sql`"Scan" s
    JOIN "Ticket" t ON t."id" = s."ticketId"
    LEFT JOIN "Subscription" sb ON sb."id" = t."subscriptionId"`;
  const [ticketRows, hourRows, deviceRows] = await Promise.all([
    db.$queryRaw<Array<{ ticketId: number; granted: number; denied: number; lastGranted: Date | null }>>`
      SELECT
        s."ticketId",
        COUNT(*) FILTER (WHERE s."result" = 'GRANTED')::int AS "granted",
        COUNT(*) FILTER (WHERE s."result" = 'DENIED')::int AS "denied",
        MAX(s."scanTime") FILTER (WHERE s."result" = 'GRANTED') AS "lastGranted"
      FROM ${from}
      WHERE ${where}
      GROUP BY 1
    `,
    db.$queryRaw<Array<{ hour: Date; result: string; count: number }>>`
      SELECT date_trunc('hour', s."scanTime") AS "hour", s."result"::text AS "result", COUNT(*)::int AS "count"
      FROM ${from}
      WHERE ${where}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
    db.$queryRaw<Array<{ deviceId: number | null; result: string; count: number; firstAt: Date }>>`
      SELECT s."deviceId", s."result"::text AS "result", COUNT(*)::int AS "count", MIN(s."scanTime") AS "firstAt"
      FROM ${from}
      WHERE ${where}
      GROUP BY 1, 2
    `,
  ]);
  return {
    tickets: ticketRows.map((r) => ({
      ticketId: Number(r.ticketId),
      granted: Number(r.granted),
      denied: Number(r.denied),
      lastGranted: r.lastGranted,
    })),
    hours: hourRows.map((r) => ({ hour: r.hour, result: r.result, count: Number(r.count) })),
    devices: deviceRows.map((r) => ({
      deviceId: r.deviceId == null ? null : Number(r.deviceId),
      result: r.result,
      count: Number(r.count),
      firstAt: r.firstAt,
    })),
  };
}
