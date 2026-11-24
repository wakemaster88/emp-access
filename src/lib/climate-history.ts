/**
 * Klimaverlauf: Temperatur und Luftfeuchte je Fuehler als Zeitreihe.
 *
 * Quelle ist der Hub, der die Fuehler im LAN jede Minute liest und
 * 5-Minuten-Mittel meldet (POST /api/hub/climate-samples). Faellt der Hub
 * aus, schreibt der Klima-Takt der Cloud einen Punkt aus dem Shelly-Cloud-
 * Status, damit kein Loch entsteht (`recordCloudSample`, nur wenn der Hub
 * fuer das Fenster nichts geliefert hat).
 *
 * Aufbewahrung: 5-Minuten-Punkte 90 Tage, Stunden 2 Jahre, Tage unbegrenzt.
 * `runClimateHistoryTick` verdichtet aeltere Punkte (Mittel nach `count`
 * gewichtet, Min/Max bleiben) und loescht die feinen.
 */

import type { ClimateResolution, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type Resolution = ClimateResolution;

export const RESOLUTION_MS: Record<Resolution, number> = {
  MIN5: 5 * 60_000,
  HOUR: 60 * 60_000,
  DAY: 24 * 60 * 60_000,
};

/** So lange bleiben 5-Minuten-Punkte, danach werden sie zu Stunden. */
export const KEEP_MIN5_DAYS = 90;
/** So lange bleiben Stunden, danach werden sie zu Tagen. */
export const KEEP_HOUR_DAYS = 730;

/** Hoechstens so viele feine Punkte je Takt verdichten (Laufzeit des Crons). */
const ROLLUP_BATCH = 4000;

export interface SampleStats {
  tempMin: number | null;
  tempAvg: number | null;
  tempMax: number | null;
  humMin: number | null;
  humAvg: number | null;
  humMax: number | null;
  count: number;
}

/** Beginn des Fensters, in das `ms` faellt (UTC). */
export function bucketStart(ms: number, resolution: Resolution): number {
  const size = RESOLUTION_MS[resolution];
  return Math.floor(ms / size) * size;
}

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const minOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.min(a, b));
const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

/**
 * Mehrere Fenster zu einem zusammenfassen. Mittel nach `count` gewichtet,
 * getrennt fuer Temperatur und Feuchte (ein Fenster ohne Feuchte zaehlt dort
 * nicht mit). null, wenn nichts da ist.
 */
export function mergeStats(list: SampleStats[]): SampleStats | null {
  if (list.length === 0) return null;
  let tempW = 0;
  let tempSum = 0;
  let humW = 0;
  let humSum = 0;
  let count = 0;
  let tempMin: number | null = null;
  let tempMax: number | null = null;
  let humMin: number | null = null;
  let humMax: number | null = null;
  for (const s of list) {
    const w = Math.max(1, s.count);
    count += w;
    if (s.tempAvg != null) {
      tempW += w;
      tempSum += s.tempAvg * w;
      tempMin = minOf(tempMin, s.tempMin ?? s.tempAvg);
      tempMax = maxOf(tempMax, s.tempMax ?? s.tempAvg);
    }
    if (s.humAvg != null) {
      humW += w;
      humSum += s.humAvg * w;
      humMin = minOf(humMin, s.humMin ?? s.humAvg);
      humMax = maxOf(humMax, s.humMax ?? s.humAvg);
    }
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    tempMin,
    tempAvg: tempW > 0 ? round(tempSum / tempW) : null,
    tempMax,
    humMin,
    humAvg: humW > 0 ? round(humSum / humW) : null,
    humMax,
    count,
  };
}

export interface HubSample extends SampleStats {
  deviceId: number;
  bucketStart: Date;
}

/** Ein vom Hub gemeldetes 5-Minuten-Fenster pruefen; null bei Unsinn. */
export function parseHubSample(raw: unknown, nowMs: number): HubSample | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const deviceId = fin(r.deviceId);
  const at = typeof r.bucketStart === "string" ? Date.parse(r.bucketStart) : fin(r.bucketStart);
  if (deviceId == null || !Number.isInteger(deviceId) || deviceId <= 0 || at == null) return null;
  // Nicht in der Zukunft, nicht aelter als die Aufbewahrung der feinen Punkte.
  if (at > nowMs + 10 * 60_000 || at < nowMs - KEEP_MIN5_DAYS * 24 * 3_600_000) return null;
  const tempAvg = fin(r.tempAvg);
  const humAvg = fin(r.humAvg);
  if (tempAvg == null && humAvg == null) return null;
  const inRange = (v: number | null, lo: number, hi: number) => (v != null && v >= lo && v <= hi ? v : null);
  const stats: SampleStats = {
    tempMin: inRange(fin(r.tempMin) ?? tempAvg, -50, 100),
    tempAvg: inRange(tempAvg, -50, 100),
    tempMax: inRange(fin(r.tempMax) ?? tempAvg, -50, 100),
    humMin: inRange(fin(r.humMin) ?? humAvg, 0, 100),
    humAvg: inRange(humAvg, 0, 100),
    humMax: inRange(fin(r.humMax) ?? humAvg, 0, 100),
    count: Math.max(1, Math.min(600, Math.round(fin(r.count) ?? 1))),
  };
  if (stats.tempAvg == null && stats.humAvg == null) return null;
  return { deviceId, bucketStart: new Date(bucketStart(at, "MIN5")), ...stats };
}

/**
 * Vom Hub gemeldete Fenster speichern. Der Hub gewinnt gegen einen Punkt, den
 * die Cloud als Notnagel geschrieben hat. Liefert die Zahl der gespeicherten.
 */
export async function storeHubSamples(
  accountId: number,
  samples: HubSample[],
): Promise<number> {
  if (samples.length === 0) return 0;
  const devices = await prisma.device.findMany({
    where: { accountId, id: { in: [...new Set(samples.map((s) => s.deviceId))] } },
    select: { id: true, keyRoomId: true },
  });
  const roomOf = new Map(devices.map((d) => [d.id, d.keyRoomId]));
  let stored = 0;
  for (const s of samples) {
    if (!roomOf.has(s.deviceId)) continue;
    const data = {
      tempMin: s.tempMin,
      tempAvg: s.tempAvg,
      tempMax: s.tempMax,
      humMin: s.humMin,
      humAvg: s.humAvg,
      humMax: s.humMax,
      count: s.count,
      source: "hub",
      roomId: roomOf.get(s.deviceId) ?? null,
    };
    await prisma.climateSample.upsert({
      where: { deviceId_resolution_bucketStart: { deviceId: s.deviceId, resolution: "MIN5", bucketStart: s.bucketStart } },
      create: { accountId, deviceId: s.deviceId, resolution: "MIN5", bucketStart: s.bucketStart, ...data },
      update: data,
    });
    stored++;
  }
  return stored;
}

/**
 * Notnagel ohne Hub: einen Punkt aus dem Cloud-Status schreiben, wenn fuer
 * das 5-Minuten-Fenster noch nichts da ist.
 */
export async function recordCloudSample(input: {
  accountId: number;
  deviceId: number;
  roomId: number | null;
  at: Date;
  tempC: number | null;
  humidity: number | null;
}): Promise<void> {
  if (input.tempC == null && input.humidity == null) return;
  await prisma.climateSample.createMany({
    data: [
      {
        accountId: input.accountId,
        deviceId: input.deviceId,
        roomId: input.roomId,
        resolution: "MIN5",
        bucketStart: new Date(bucketStart(input.at.getTime(), "MIN5")),
        tempMin: input.tempC,
        tempAvg: input.tempC,
        tempMax: input.tempC,
        humMin: input.humidity,
        humAvg: input.humidity,
        humMax: input.humidity,
        count: 1,
        source: "cloud",
      },
    ],
    skipDuplicates: true,
  });
}

export interface ClimateHistoryTickResult {
  hours: number;
  days: number;
  deleted: number;
}

/** Feine Punkte vor dem Stichtag zur naechsten Aufloesung verdichten. */
async function rollup(
  from: Resolution,
  to: Resolution,
  cutoff: Date,
): Promise<{ written: number; deleted: number }> {
  const rows = await prisma.climateSample.findMany({
    where: { resolution: from, bucketStart: { lt: cutoff } },
    orderBy: [{ deviceId: "asc" }, { bucketStart: "asc" }],
    take: ROLLUP_BATCH,
  });
  if (rows.length === 0) return { written: 0, deleted: 0 };

  // Das letzte (Geraet, Zielfenster) kann unvollstaendig sein, wenn der Batch
  // mitten im Fenster endet – es bleibt fuer den naechsten Takt liegen.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.deviceId}:${bucketStart(r.bucketStart.getTime(), to)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const keys = [...groups.keys()];
  if (rows.length === ROLLUP_BATCH && keys.length > 1) groups.delete(keys[keys.length - 1]);

  let written = 0;
  let deleted = 0;
  for (const [key, list] of groups) {
    const [deviceIdStr, bucketStr] = key.split(":");
    const deviceId = Number(deviceIdStr);
    const start = new Date(Number(bucketStr));
    const existing = await prisma.climateSample.findUnique({
      where: { deviceId_resolution_bucketStart: { deviceId, resolution: to, bucketStart: start } },
    });
    const merged = mergeStats([...(existing ? [existing] : []), ...list]);
    if (!merged) continue;
    const last = list[list.length - 1];
    const data = { ...merged, roomId: last.roomId, source: list.some((r) => r.source === "hub") ? "hub" : last.source };
    await prisma.$transaction([
      prisma.climateSample.upsert({
        where: { deviceId_resolution_bucketStart: { deviceId, resolution: to, bucketStart: start } },
        create: { accountId: last.accountId, deviceId, resolution: to, bucketStart: start, ...data },
        update: data,
      }),
      prisma.climateSample.deleteMany({ where: { id: { in: list.map((r) => r.id) } } }),
    ]);
    written++;
    deleted += list.length;
  }
  return { written, deleted };
}

export async function runClimateHistoryTick(now = new Date()): Promise<ClimateHistoryTickResult> {
  const hourCutoff = new Date(now.getTime() - KEEP_MIN5_DAYS * 24 * 3_600_000);
  const dayCutoff = new Date(now.getTime() - KEEP_HOUR_DAYS * 24 * 3_600_000);
  const h = await rollup("MIN5", "HOUR", hourCutoff);
  const d = await rollup("HOUR", "DAY", dayCutoff);
  return { hours: h.written, days: d.written, deleted: h.deleted + d.deleted };
}

// ─── Abfrage fuer die Anzeige ────────────────────────────────────────────────

export type HistoryRange = "day" | "week" | "month" | "year";

export const RANGE_SPEC: Record<HistoryRange, { spanMs: number; bucketMs: number }> = {
  day: { spanMs: 24 * 3_600_000, bucketMs: 5 * 60_000 },
  week: { spanMs: 7 * 24 * 3_600_000, bucketMs: 30 * 60_000 },
  month: { spanMs: 30 * 24 * 3_600_000, bucketMs: 3 * 3_600_000 },
  year: { spanMs: 365 * 24 * 3_600_000, bucketMs: 24 * 3_600_000 },
};

export function isHistoryRange(v: unknown): v is HistoryRange {
  return v === "day" || v === "week" || v === "month" || v === "year";
}

export interface HistoryPoint extends SampleStats {
  /** Fensterbeginn als Unix-Millisekunden. */
  t: number;
}

export interface HistorySeries {
  deviceId: number;
  name: string;
  points: HistoryPoint[];
  /** Letzter bekannter Wert im Zeitraum. */
  last: { t: number; tempC: number | null; humidity: number | null } | null;
  stats: SampleStats | null;
}

/** Zeitraeume, deren Fenster die Datenbank selbst verdichtet (viele Rohpunkte je Fenster). */
const SQL_BUCKET_RANGES: ReadonlySet<HistoryRange> = new Set(["month", "year"]);

/** Ein in SQL verdichtetes Anzeigefenster: Summen statt Mittel, gerechnet wie in `mergeStats`. */
export interface BucketSums {
  tempMin: number | null;
  tempMax: number | null;
  /** Summe von tempAvg * max(1, count) ueber die Punkte mit Temperatur. */
  tempSum: number | null;
  /** Summe von max(1, count) ueber die Punkte mit Temperatur. */
  tempW: number | null;
  humMin: number | null;
  humMax: number | null;
  humSum: number | null;
  humW: number | null;
  /** Summe von max(1, count) ueber alle Punkte. */
  count: number;
}

/** Wert aus einer Rohabfrage als Zahl; null bleibt null (der Treiber kann Zahlen auch als Text liefern). */
function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

/** Summen eines Fensters in Kennwerte umrechnen, mit derselben Rundung wie `mergeStats`. */
export function statsFromSums(raw: BucketSums): SampleStats {
  const b = {
    tempMin: numOrNull(raw.tempMin),
    tempMax: numOrNull(raw.tempMax),
    tempSum: numOrNull(raw.tempSum),
    tempW: numOrNull(raw.tempW),
    humMin: numOrNull(raw.humMin),
    humMax: numOrNull(raw.humMax),
    humSum: numOrNull(raw.humSum),
    humW: numOrNull(raw.humW),
    count: Number(raw.count),
  };
  const round = (v: number) => Math.round(v * 100) / 100;
  const avg = (sum: number | null, w: number | null) => (sum != null && w != null && w > 0 ? round(sum / w) : null);
  return {
    tempMin: b.tempMin,
    tempAvg: avg(b.tempSum, b.tempW),
    tempMax: b.tempMax,
    humMin: b.humMin,
    humAvg: avg(b.humSum, b.humW),
    humMax: b.humMax,
    count: b.count,
  };
}

/**
 * Verlauf eines Raums im gewaehlten Zeitraum, je Fuehler eine Reihe, auf das
 * Anzeigefenster verdichtet. Liest alle Aufloesungen, weil junge Daten als
 * 5-Minuten-Punkte und alte als Stunden oder Tage liegen. Monat und Jahr
 * verdichtet die Datenbank (`roomHistorySql`), Tag und Woche dieser Code.
 */
export async function roomHistory(
  accountId: number,
  roomId: number,
  range: HistoryRange,
  nowMs: number,
): Promise<{ from: number; to: number; bucketMs: number; series: HistorySeries[] }> {
  const spec = RANGE_SPEC[range];
  const to = Math.ceil(nowMs / spec.bucketMs) * spec.bucketMs;
  const from = to - spec.spanMs;
  if (SQL_BUCKET_RANGES.has(range)) {
    return { from, to, bucketMs: spec.bucketMs, series: await roomHistorySql(accountId, roomId, from, to, spec.bucketMs) };
  }
  const rows = await prisma.climateSample.findMany({
    where: { accountId, roomId, bucketStart: { gte: new Date(from), lt: new Date(to) } },
    orderBy: { bucketStart: "asc" },
    select: {
      deviceId: true,
      bucketStart: true,
      tempMin: true,
      tempAvg: true,
      tempMax: true,
      humMin: true,
      humAvg: true,
      humMax: true,
      count: true,
      device: { select: { name: true } },
    },
  });
  const byDevice = new Map<number, { name: string; buckets: Map<number, SampleStats[]> }>();
  for (const r of rows) {
    const dev = byDevice.get(r.deviceId) ?? { name: r.device.name, buckets: new Map() };
    const t = Math.floor(r.bucketStart.getTime() / spec.bucketMs) * spec.bucketMs;
    dev.buckets.set(t, [...(dev.buckets.get(t) ?? []), r]);
    byDevice.set(r.deviceId, dev);
  }
  const series: HistorySeries[] = [];
  for (const [deviceId, dev] of byDevice) {
    const points: HistoryPoint[] = [];
    for (const [t, list] of [...dev.buckets.entries()].sort((a, b) => a[0] - b[0])) {
      const merged = mergeStats(list);
      if (merged) points.push({ t, ...merged });
    }
    const lastRow = rows.filter((r) => r.deviceId === deviceId).at(-1);
    series.push({
      deviceId,
      name: dev.name,
      points,
      last: lastRow ? { t: lastRow.bucketStart.getTime(), tempC: lastRow.tempAvg, humidity: lastRow.humAvg } : null,
      stats: mergeStats(points),
    });
  }
  series.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return { from, to, bucketMs: spec.bucketMs, series };
}

/**
 * Wie der Rest von `roomHistory`, aber die Fenster rechnet Postgres: je
 * Fuehler und Anzeigefenster eine Zeile mit Min/Max und den Summen fuer das
 * gewichtete Mittel (Regeln wie `mergeStats`). Dazu je Fuehler der letzte Punkt.
 */
async function roomHistorySql(
  accountId: number,
  roomId: number,
  from: number,
  to: number,
  bucketMs: number,
): Promise<HistorySeries[]> {
  // Als Text mit ::timestamp: die Spalte ist UTC ohne Zeitzone, so haengt der
  // Vergleich nicht an der Zeitzone der Datenbank-Sitzung.
  const fromTs = new Date(from).toISOString();
  const toTs = new Date(to).toISOString();
  const [buckets, lasts] = await Promise.all([
    prisma.$queryRaw<Array<BucketSums & { deviceId: number; t: number; firstT: number }>>`
      SELECT s."deviceId",
        (floor(extract(epoch FROM s."bucketStart") * 1000 / ${bucketMs}) * ${bucketMs})::float8 AS "t",
        min(extract(epoch FROM s."bucketStart") * 1000)::float8 AS "firstT",
        min(coalesce(s."tempMin", s."tempAvg")) FILTER (WHERE s."tempAvg" IS NOT NULL) AS "tempMin",
        max(coalesce(s."tempMax", s."tempAvg")) FILTER (WHERE s."tempAvg" IS NOT NULL) AS "tempMax",
        sum(s."tempAvg" * greatest(1, s."count")) FILTER (WHERE s."tempAvg" IS NOT NULL) AS "tempSum",
        sum(greatest(1, s."count")::float8) FILTER (WHERE s."tempAvg" IS NOT NULL) AS "tempW",
        min(coalesce(s."humMin", s."humAvg")) FILTER (WHERE s."humAvg" IS NOT NULL) AS "humMin",
        max(coalesce(s."humMax", s."humAvg")) FILTER (WHERE s."humAvg" IS NOT NULL) AS "humMax",
        sum(s."humAvg" * greatest(1, s."count")) FILTER (WHERE s."humAvg" IS NOT NULL) AS "humSum",
        sum(greatest(1, s."count")::float8) FILTER (WHERE s."humAvg" IS NOT NULL) AS "humW",
        sum(greatest(1, s."count")::float8) AS "count"
      FROM "ClimateSample" s
      WHERE s."accountId" = ${accountId} AND s."roomId" = ${roomId}
        AND s."bucketStart" >= ${fromTs}::timestamp AND s."bucketStart" < ${toTs}::timestamp
      GROUP BY 1, 2
      ORDER BY 2, 1`,
    prisma.$queryRaw<Array<{ deviceId: number; name: string; t: number; tempAvg: number | null; humAvg: number | null }>>`
      SELECT DISTINCT ON (s."deviceId") s."deviceId", d."name",
        (extract(epoch FROM s."bucketStart") * 1000)::float8 AS "t", s."tempAvg", s."humAvg"
      FROM "ClimateSample" s
      JOIN "Device" d ON d."id" = s."deviceId"
      WHERE s."accountId" = ${accountId} AND s."roomId" = ${roomId}
        AND s."bucketStart" >= ${fromTs}::timestamp AND s."bucketStart" < ${toTs}::timestamp
      ORDER BY s."deviceId", s."bucketStart" DESC`,
  ]);
  const lastOf = new Map(lasts.map((l) => [Number(l.deviceId), l]));
  // Reihenfolge wie bisher: Fuehler in der Folge ihres ersten genauen Punkts, danach nach Name.
  const byDevice = new Map<number, { firstT: number; points: HistoryPoint[] }>();
  for (const b of buckets) {
    const deviceId = Number(b.deviceId);
    const dev = byDevice.get(deviceId) ?? { firstT: Number(b.firstT), points: [] };
    dev.firstT = Math.min(dev.firstT, Number(b.firstT));
    dev.points.push({ t: Number(b.t), ...statsFromSums(b) });
    byDevice.set(deviceId, dev);
  }
  const series: HistorySeries[] = [];
  for (const [deviceId, { points }] of [...byDevice].sort((a, b) => a[1].firstT - b[1].firstT || a[0] - b[0])) {
    const last = lastOf.get(deviceId);
    series.push({
      deviceId,
      name: last?.name ?? "",
      points,
      last: last ? { t: Number(last.t), tempC: numOrNull(last.tempAvg), humidity: numOrNull(last.humAvg) } : null,
      stats: mergeStats(points),
    });
  }
  series.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return series;
}

export type ClimateSampleWhere = Prisma.ClimateSampleWhereInput;
