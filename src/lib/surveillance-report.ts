/**
 * Überwachungs-Nachtbericht: Zeitraum aus Zeitplan-Fenster ableiten
 * und Sightings/Events inkl. Snapshot-Flags aggregieren.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface SurveillancePeriod {
  /** Start-Kalendertag in Account-TZ (YYYY-MM-DD) – Anker der Periode. */
  key: string;
  start: Date;
  end: Date;
  overnight: boolean;
  inProgress: boolean;
  completed: boolean;
  label: string;
}

export interface ReportPersonSighting {
  id: number;
  kind: "PERSON";
  seenAt: string;
  hasSnapshot: boolean;
  matched: boolean;
  listType: string | null;
  matchScore: number | null;
  camera: { id: number; name: string } | null;
  listedPerson: { id: number; name: string; listType: string } | null;
  snapshotUrl: string | null;
}

export interface ReportVehicleSighting {
  id: number;
  kind: "VEHICLE";
  seenAt: string;
  hasSnapshot: boolean;
  matched: boolean;
  plate: string | null;
  camera: { id: number; name: string } | null;
  allowedVehicle: { id: number; name: string; plate: string } | null;
  snapshotUrl: string | null;
}

export interface ReportCameraEvent {
  id: number;
  kind: "EVENT";
  type: string;
  startedAt: string;
  endedAt: string | null;
  camera: { id: number; name: string };
}

export type ReportTimelineItem =
  | ReportPersonSighting
  | ReportVehicleSighting
  | ReportCameraEvent;

export interface SurveillanceReport {
  period: SurveillancePeriod;
  periods: Array<Pick<SurveillancePeriod, "key" | "label" | "inProgress" | "completed" | "start" | "end">>;
  windowStart: string;
  windowEnd: string;
  summary: {
    persons: number;
    vehicles: number;
    events: number;
    personSnapshots: number;
    vehicleSnapshots: number;
    byType: Record<string, number>;
  };
  persons: ReportPersonSighting[];
  vehicles: ReportVehicleSighting[];
  events: ReportCameraEvent[];
  /** Chronologisch (neueste zuerst): nur Sightings mit Snapshot. */
  timeline: ReportTimelineItem[];
}

type Ymd = { y: number; m: number; d: number };

function parseHhmm(hhmm: string): { h: number; min: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return null;
  return { h: Number(m[1]), min: Number(m[2]) };
}

function zonedYmd(date: Date, tz: string): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    y: Number(parts.find((p) => p.type === "year")?.value),
    m: Number(parts.find((p) => p.type === "month")?.value),
    d: Number(parts.find((p) => p.type === "day")?.value),
  };
}

function ymdKey(ymd: Ymd): string {
  return `${ymd.y}-${String(ymd.m).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`;
}

function addDays(ymd: Ymd, days: number): Ymd {
  const utc = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

/** Wanduhrzeit (Datum + HH:mm) in TZ → UTC-Date. DST-robust. */
function zonedWallTimeToUtc(ymd: Ymd, hhmm: string, tz: string): Date | null {
  const parsed = parseHhmm(hhmm);
  if (!parsed) return null;
  const { h, min } = parsed;
  let guess = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, h, min, 0));
  for (let i = 0; i < 2; i++) {
    const shown = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(guess);
    const gy = Number(shown.find((p) => p.type === "year")?.value);
    const gmo = Number(shown.find((p) => p.type === "month")?.value);
    const gd = Number(shown.find((p) => p.type === "day")?.value);
    const gh = Number(shown.find((p) => p.type === "hour")?.value);
    const gm = Number(shown.find((p) => p.type === "minute")?.value);
    const diff =
      Date.UTC(ymd.y, ymd.m - 1, ymd.d, h, min, 0) - Date.UTC(gy, gmo - 1, gd, gh, gm, 0);
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function weekdayBitIndexForYmd(ymd: Ymd, tz: string): number {
  // Mittag UTC-Näherung reicht für Wochentag in TZ.
  const noon = zonedWallTimeToUtc(ymd, "12:00", tz) ?? new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12));
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
    .format(noon)
    .toLowerCase();
  const map: Record<string, number> = {
    mon: 0,
    tue: 1,
    wed: 2,
    thu: 3,
    fri: 4,
    sat: 5,
    sun: 6,
  };
  return map[weekday] ?? 0;
}

function formatDayLabel(ymd: Ymd, tz: string): string {
  const noon = zonedWallTimeToUtc(ymd, "12:00", tz) ?? new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12));
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(noon);
}

function periodLabel(
  startYmd: Ymd,
  endYmd: Ymd,
  windowStart: string,
  windowEnd: string,
  overnight: boolean,
  tz: string
): string {
  if (overnight) {
    return `${formatDayLabel(startYmd, tz)} ${windowStart} – ${formatDayLabel(endYmd, tz)} ${windowEnd}`;
  }
  return `${formatDayLabel(startYmd, tz)} ${windowStart}–${windowEnd}`;
}

/**
 * Baut eine Periode, die am Kalendertag `startKey` (YYYY-MM-DD) um windowStart beginnt.
 */
export function buildPeriodForStartKey(
  startKey: string,
  windowStart: string,
  windowEnd: string,
  tz: string,
  now: Date = new Date()
): SurveillancePeriod | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startKey);
  if (!m) return null;
  const startYmd: Ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const startParsed = parseHhmm(windowStart);
  const endParsed = parseHhmm(windowEnd);
  if (!startParsed || !endParsed) return null;

  // Start < Ende = gleicher Kalendertag; sonst über Mitternacht (inkl. Start==Ende → 24h).
  const startM = startParsed.h * 60 + startParsed.min;
  const endM = endParsed.h * 60 + endParsed.min;
  const sameDay = startM < endM;
  const endYmd = sameDay ? startYmd : addDays(startYmd, 1);

  const start = zonedWallTimeToUtc(startYmd, windowStart, tz);
  const end = zonedWallTimeToUtc(endYmd, windowEnd, tz);
  if (!start || !end) return null;

  const inProgress = now >= start && now < end;
  const completed = now >= end;

  return {
    key: ymdKey(startYmd),
    start,
    end,
    overnight: !sameDay,
    inProgress,
    completed,
    label: periodLabel(startYmd, endYmd, windowStart, windowEnd, !sameDay, tz),
  };
}

/**
 * Letzte N Perioden (neueste zuerst), gefiltert nach daysOfWeek-Bitmaske am Starttag.
 */
export function listSurveillancePeriods(opts: {
  windowStart: string;
  windowEnd: string;
  daysOfWeek: number;
  timezone: string | null | undefined;
  now?: Date;
  count?: number;
  lookbackDays?: number;
}): SurveillancePeriod[] {
  const tz = opts.timezone ?? "Europe/Berlin";
  const now = opts.now ?? new Date();
  const count = opts.count ?? 14;
  const lookback = opts.lookbackDays ?? 45;
  const today = zonedYmd(now, tz);

  const out: SurveillancePeriod[] = [];
  for (let i = 0; i < lookback && out.length < count; i++) {
    const startYmd = addDays(today, -i);
    const bit = weekdayBitIndexForYmd(startYmd, tz);
    if (((opts.daysOfWeek >> bit) & 1) !== 1) continue;

    const period = buildPeriodForStartKey(
      ymdKey(startYmd),
      opts.windowStart,
      opts.windowEnd,
      tz,
      now
    );
    if (!period) continue;
    // Zukünftige Perioden (noch nicht gestartet) überspringen.
    if (period.start > now) continue;
    out.push(period);
  }
  return out;
}

export function pickDefaultPeriod(periods: SurveillancePeriod[]): SurveillancePeriod | null {
  if (periods.length === 0) return null;
  const current = periods.find((p) => p.inProgress);
  if (current) return current;
  return periods[0] ?? null;
}

async function snapshotIdSet(
  table: "PersonSighting" | "VehicleSighting",
  accountId: number,
  ids: number[]
): Promise<Set<number>> {
  const set = new Set<number>();
  if (ids.length === 0) return set;
  if (table === "PersonSighting") {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "PersonSighting"
      WHERE "accountId" = ${accountId}
        AND snapshot IS NOT NULL
        AND id IN (${Prisma.join(ids)})
    `;
    for (const r of rows) set.add(r.id);
  } else {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "VehicleSighting"
      WHERE "accountId" = ${accountId}
        AND snapshot IS NOT NULL
        AND id IN (${Prisma.join(ids)})
    `;
    for (const r of rows) set.add(r.id);
  }
  return set;
}

export async function buildSurveillanceReport(opts: {
  accountId: number;
  periodKey?: string | null;
  now?: Date;
}): Promise<SurveillanceReport | { error: string; status: number }> {
  const now = opts.now ?? new Date();

  const [account, config] = await Promise.all([
    prisma.account.findUnique({
      where: { id: opts.accountId },
      select: { timezone: true },
    }),
    prisma.surveillanceConfig.findUnique({
      where: { accountId: opts.accountId },
      include: { cameras: { select: { cameraId: true } } },
    }),
  ]);

  const tz = account?.timezone ?? "Europe/Berlin";
  const windowStart = config?.windowStart ?? "22:00";
  const windowEnd = config?.windowEnd ?? "08:00";
  const daysOfWeek = config?.daysOfWeek ?? 127;

  if (!parseHhmm(windowStart) || !parseHhmm(windowEnd)) {
    return { error: "Ungültiges Zeitfenster", status: 400 };
  }

  const periods = listSurveillancePeriods({
    windowStart,
    windowEnd,
    daysOfWeek,
    timezone: tz,
    now,
    count: 21,
  });

  let period: SurveillancePeriod | null = null;
  if (opts.periodKey) {
    period = buildPeriodForStartKey(opts.periodKey, windowStart, windowEnd, tz, now);
    if (!period) return { error: "Ungültige Periode", status: 400 };
  } else {
    period = pickDefaultPeriod(periods);
  }

  if (!period) {
    // Keine passende Periode – leerer Report mit Default-Fenster „heute Nacht“.
    const todayKey = ymdKey(zonedYmd(now, tz));
    period = buildPeriodForStartKey(todayKey, windowStart, windowEnd, tz, now);
    if (!period) return { error: "Periode nicht berechenbar", status: 500 };
  }

  const cameraIds = config?.cameras.map((c) => c.cameraId) ?? [];
  const cameraFilter =
    cameraIds.length > 0 ? { cameraId: { in: cameraIds } } : {};

  // Nur klare Hub-Auffälligkeiten: Personen-/Fahrzeug-Sightings mit Snapshot.
  // Reine Bewegung (MOTION) ohne Bestätigung bleibt draußen.
  const [personRows, vehicleRows] = await Promise.all([
    // Explizites select ohne `snapshot`: mit include wuerden die JPEG-Bytes
    // aller (bis zu 500) Sichtungen bei jedem Report-Aufbau aus der DB
    // uebertragen – der Report braucht nur Metadaten + Snapshot-URLs.
    prisma.personSighting.findMany({
      where: {
        accountId: opts.accountId,
        seenAt: { gte: period.start, lt: period.end },
        ...cameraFilter,
      },
      select: {
        id: true,
        seenAt: true,
        matched: true,
        listType: true,
        matchScore: true,
        camera: { select: { id: true, name: true } },
        listedPerson: { select: { id: true, name: true, listType: true } },
      },
      orderBy: { seenAt: "desc" },
      take: 500,
    }),
    prisma.vehicleSighting.findMany({
      where: {
        accountId: opts.accountId,
        seenAt: { gte: period.start, lt: period.end },
        ...cameraFilter,
      },
      select: {
        id: true,
        seenAt: true,
        matched: true,
        plate: true,
        camera: { select: { id: true, name: true } },
        allowedVehicle: { select: { id: true, name: true, plate: true } },
      },
      orderBy: { seenAt: "desc" },
      take: 500,
    }),
  ]);

  const [personSnapIds, vehicleSnapIds] = await Promise.all([
    snapshotIdSet(
      "PersonSighting",
      opts.accountId,
      personRows.map((p) => p.id)
    ),
    snapshotIdSet(
      "VehicleSighting",
      opts.accountId,
      vehicleRows.map((v) => v.id)
    ),
  ]);

  const persons: ReportPersonSighting[] = personRows
    .filter((p) => personSnapIds.has(p.id))
    .map((p) => ({
      id: p.id,
      kind: "PERSON" as const,
      seenAt: p.seenAt.toISOString(),
      hasSnapshot: true,
      matched: p.matched,
      listType: p.listType,
      matchScore: p.matchScore,
      camera: p.camera,
      listedPerson: p.listedPerson,
      snapshotUrl: `/api/person-sightings/${p.id}/snapshot`,
    }));

  const vehicles: ReportVehicleSighting[] = vehicleRows
    .filter((v) => vehicleSnapIds.has(v.id))
    .map((v) => ({
      id: v.id,
      kind: "VEHICLE" as const,
      seenAt: v.seenAt.toISOString(),
      hasSnapshot: true,
      matched: v.matched,
      plate: v.plate,
      camera: v.camera,
      allowedVehicle: v.allowedVehicle,
      snapshotUrl: `/api/vehicle-sightings/${v.id}/snapshot`,
    }));

  const events: ReportCameraEvent[] = [];
  const byType: Record<string, number> = {};

  const timeline: ReportTimelineItem[] = [...persons, ...vehicles].sort((a, b) =>
    b.seenAt.localeCompare(a.seenAt)
  );

  // Sicherstellen, dass die gewählte Periode in der Liste steht.
  const periodList = [...periods];
  if (!periodList.some((p) => p.key === period!.key)) {
    periodList.unshift(period);
  }

  return {
    period: {
      ...period,
      start: period.start,
      end: period.end,
    },
    periods: periodList.map((p) => ({
      key: p.key,
      label: p.label,
      inProgress: p.inProgress,
      completed: p.completed,
      start: p.start,
      end: p.end,
    })),
    windowStart,
    windowEnd,
    summary: {
      persons: persons.length,
      vehicles: vehicles.length,
      events: events.length,
      personSnapshots: persons.filter((p) => p.hasSnapshot).length,
      vehicleSnapshots: vehicles.filter((v) => v.hasSnapshot).length,
      byType,
    },
    persons,
    vehicles,
    events,
    timeline,
  };
}
