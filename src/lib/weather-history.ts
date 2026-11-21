/**
 * Verlauf der Lufttemperatur am Standort des Betriebs, je Stunde (`WeatherHour`).
 *
 * Draussen haengt kein Fuehler. Die Werte kommen deshalb wie das Wetter fuer
 * Bewaesserung und Tagesvorschau von Open-Meteo (kostenlos, ohne Key). Der
 * 5-Minuten-Cron holt je Konto mit eingeschalteter Kunden-App und
 * eingetragenem Standort einmal je Stunde die neuen Stunden. Beim ersten Lauf
 * fuellt er rueckwirkend ab dem ersten gezaehlten Besuchstag, hoechstens ab
 * dem Vorjahr (weiter zurueck reicht der Saisonrueckblick nicht).
 *
 * Die Vorhersage-API liefert nur die letzten Tage verlaesslich: am
 * 21.11.2026 kamen mit `past_days=92` nur 72 Tage zurueck. Deshalb kommt
 * alles, was aelter ist als zehn Tage, aus dem Archiv (das haengt etwa fuenf
 * Tage hinterher). Fehlen im Bestand Stunden, holt der Takt die erste Luecke
 * einmal je Stunde nach.
 * Grundlage fuer "Luft im Schnitt" im Saisonrueckblick (loadRideTemps).
 */

import { prisma } from "@/lib/prisma";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** So viele Tage zurueck kommt die Vorhersage-API zum Einsatz (`past_days`), davor das Archiv. */
export const FORECAST_PAST_DAYS = 10;
/** Zeilen je INSERT (Parametergrenze von Postgres). */
const STORE_CHUNK = 2000;

export interface HourTemp {
  /** Volle Stunde (UTC). */
  hour: Date;
  temp: number;
}

export interface WeatherRequest {
  url: string;
  params: Record<string, string>;
  /** Nur Stunden in diesem Bereich (einschliesslich) werden uebernommen. */
  fromMs: number;
  toMs: number;
}

const floorTo = (ms: number, size: number) => Math.floor(ms / size) * size;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Ab hier wird die Lufttemperatur gebraucht: ein Tag vor dem ersten gezaehlten
 * Besuchstag (der Tag gilt in Berliner Zeit), fruehestens ab dem Vorjahr.
 * Ohne Besuchstag reicht der letzte Tag.
 */
export function historyStart(firstDay: Date | null, now: Date): Date {
  if (!firstDay) return new Date(floorTo(now.getTime(), HOUR_MS) - DAY_MS);
  const floor = Date.UTC(now.getUTCFullYear() - 1, 0, 1) - DAY_MS;
  return new Date(Math.max(firstDay.getTime() - DAY_MS, floor));
}

/**
 * Abrufe fuer die Stunden von `from` bis `to` (volle Stunden, `to` nicht in
 * der Zukunft): das Archiv fuer alles, was aelter ist als `FORECAST_PAST_DAYS`,
 * die Vorhersage-API fuer den Rest.
 */
export function weatherRequests(from: Date, to: Date, now: Date): WeatherRequest[] {
  const out: WeatherRequest[] = [];
  if (from.getTime() > to.getTime()) return out;
  const today = floorTo(now.getTime(), DAY_MS);
  const forecastStart = today - FORECAST_PAST_DAYS * DAY_MS;
  if (from.getTime() < forecastStart) {
    const end = Math.min(to.getTime(), forecastStart - HOUR_MS);
    out.push({
      url: ARCHIVE_URL,
      params: { start_date: ymd(from.getTime()), end_date: ymd(end) },
      fromMs: from.getTime(),
      toMs: end,
    });
  }
  if (to.getTime() >= forecastStart) {
    const begin = Math.max(from.getTime(), forecastStart);
    const pastDays = Math.max(0, Math.round((today - floorTo(begin, DAY_MS)) / DAY_MS));
    out.push({
      url: FORECAST_URL,
      params: { past_days: String(pastDays), forecast_days: "1" },
      fromMs: begin,
      toMs: to.getTime(),
    });
  }
  return out;
}

/** Stundenwerte aus einer Open-Meteo-Antwort (timeformat=unixtime); Luecken und Stunden ausserhalb des Bereichs fallen weg. */
export function parseHourlyTemps(data: unknown, fromMs: number, toMs: number): HourTemp[] {
  const hourly = (data as { hourly?: { time?: unknown; temperature_2m?: unknown } } | null)?.hourly;
  const time: unknown[] = Array.isArray(hourly?.time) ? hourly.time : [];
  const temps: unknown[] = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : [];
  const out: HourTemp[] = [];
  time.forEach((t, i) => {
    const temp = temps[i];
    if (typeof t !== "number" || typeof temp !== "number" || !Number.isFinite(temp)) return;
    const ms = t * 1000;
    if (ms % HOUR_MS !== 0 || ms < fromMs || ms > toMs) return;
    out.push({ hour: new Date(ms), temp });
  });
  return out;
}

async function fetchHours(lat: number, lng: number, req: WeatherRequest): Promise<HourTemp[] | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: "temperature_2m",
    timeformat: "unixtime",
    ...req.params,
  });
  try {
    const res = await fetch(`${req.url}?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return parseHourlyTemps(await res.json(), req.fromMs, req.toMs);
  } catch {
    return null;
  }
}

async function store(accountId: number, rows: HourTemp[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += STORE_CHUNK) {
    const res = await prisma.weatherHour.createMany({
      data: rows.slice(i, i + STORE_CHUNK).map((r) => ({ accountId, hour: r.hour, temp: r.temp })),
      skipDuplicates: true,
    });
    written += res.count;
  }
  return written;
}

/** Stunden von `from` bis `to` holen und speichern. `ok` ist false, sobald ein Abruf scheitert. */
async function syncRange(
  account: { id: number; lat: number; lng: number },
  from: Date,
  to: Date,
  now: Date,
): Promise<{ written: number; ok: boolean }> {
  let written = 0;
  let ok = true;
  for (const req of weatherRequests(from, to, now)) {
    const rows = await fetchHours(account.lat, account.lng, req);
    if (rows) written += await store(account.id, rows);
    else ok = false;
  }
  return { written, ok };
}

/**
 * Erste Luecke im Bestand ab `start`: vor der ersten gespeicherten Stunde oder
 * mitten im Verlauf. Null, wenn von `start` bis zur letzten Stunde nichts fehlt.
 */
async function firstGap(
  accountId: number,
  start: Date,
  edge: { first: Date; last: Date; count: number },
): Promise<{ from: Date; to: Date } | null> {
  if (edge.first.getTime() > start.getTime()) return { from: start, to: new Date(edge.first.getTime() - HOUR_MS) };
  const expected = Math.round((edge.last.getTime() - start.getTime()) / HOUR_MS) + 1;
  if (edge.count >= expected) return null;
  const rows = await prisma.$queryRaw<Array<{ after: Date; before: Date }>>`
    SELECT t."hour" AS "after", t."next" AS "before"
    FROM (
      SELECT w."hour", lead(w."hour") OVER (ORDER BY w."hour") AS "next"
      FROM "WeatherHour" w
      WHERE w."accountId" = ${accountId} AND w."hour" >= ${start}
    ) t
    WHERE t."next" - t."hour" > interval '1 hour'
    ORDER BY t."hour"
    LIMIT 1`;
  const gap = rows[0];
  if (!gap) return null;
  return { from: new Date(gap.after.getTime() + HOUR_MS), to: new Date(gap.before.getTime() - HOUR_MS) };
}

async function syncAccount(account: { id: number; lat: number; lng: number }, now: Date): Promise<{ written: number; ok: boolean }> {
  const to = new Date(floorTo(now.getTime(), HOUR_MS));
  const firstStat = await prisma.riderDayStat.findFirst({
    where: { accountId: account.id },
    orderBy: { day: "asc" },
    select: { day: true },
  });
  const start = historyStart(firstStat?.day ?? null, now);
  const edge = await prisma.weatherHour.aggregate({
    where: { accountId: account.id, hour: { gte: start } },
    _min: { hour: true },
    _max: { hour: true },
    _count: true,
  });
  const first = edge._min.hour;
  const last = edge._max.hour;
  let written = 0;
  let ok = true;

  // Neue Stunden bis jetzt; ohne Bestand gleich alles ab `start`.
  const next = last ? new Date(last.getTime() + HOUR_MS) : start;
  if (next.getTime() <= to.getTime()) {
    const res = await syncRange(account, next, to, now);
    written += res.written;
    ok = res.ok;
  }
  // Luecke im Bestand (ein Abruf scheiterte, der Dienst lieferte Stunden ohne
  // Wert oder es kamen aeltere Besuchstage dazu): einmal je Stunde nachholen.
  if (first && last && now.getUTCMinutes() < 5) {
    const gap = await firstGap(account.id, start, { first, last, count: edge._count });
    if (gap) {
      const res = await syncRange(account, gap.from, gap.to, now);
      written += res.written;
      ok = ok && res.ok;
    }
  }
  return { written, ok };
}

/** Lufttemperatur der laufenden Stunde in °C (höchstens drei Stunden alt), sonst null. */
export async function loadAirNow(accountId: number, now: Date = new Date()): Promise<number | null> {
  const row = await prisma.weatherHour.findFirst({
    where: { accountId, hour: { gte: new Date(now.getTime() - 3 * HOUR_MS), lte: now } },
    orderBy: { hour: "desc" },
    select: { temp: true },
  });
  return row?.temp ?? null;
}

export interface WeatherHistoryTickResult {
  accounts: number;
  written: number;
  failed: number;
}

/** Cron (tick-5min): Lufttemperatur fuer alle Konten mit Kunden-App und Standort fortschreiben. */
export async function runWeatherHistoryTick(now = new Date()): Promise<WeatherHistoryTickResult> {
  const configs = await prisma.gamificationConfig.findMany({
    where: { enabled: true, account: { latitude: { not: null }, longitude: { not: null } } },
    select: { accountId: true, account: { select: { latitude: true, longitude: true } } },
  });
  const result: WeatherHistoryTickResult = { accounts: configs.length, written: 0, failed: 0 };
  for (const c of configs) {
    try {
      const res = await syncAccount({ id: c.accountId, lat: c.account.latitude!, lng: c.account.longitude! }, now);
      result.written += res.written;
      if (!res.ok) result.failed += 1;
    } catch (e) {
      result.failed += 1;
      console.error(`[weather-history] Konto ${c.accountId}:`, e instanceof Error ? e.message : e);
    }
  }
  return result;
}
