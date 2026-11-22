/**
 * Gamification: Datenbank-Seite (Tagessummen schreiben, Meilensteine vergeben,
 * Leistungs-Gutscheine entwerten, Rückrechnung). Die Rechenlogik steht in
 * `gamification.ts`.
 */
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, tenantClient, type TenantDb } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { runChallenges } from "./challenge-service";
import { notifyAward } from "./rider-push";
import { grantSkill } from "./rider-skills";
import { beachEntranceIds } from "./beach-occupancy";
import { audiencesFor, beachOnlySubscriptionIds, isBeachSubscription, passKindOf } from "./rider-pass";
import {
  aggregateScans,
  awardKey,
  benefitVoucherState,
  dbDateToYmd,
  mergeDayStats,
  reachedMilestones,
  seasonsCount,
  ymdToDbDate,
  ALL_TIME_KEY,
  BENEFIT_STATE_MESSAGE,
  EARLY_WINDOW_MS,
  WATER_WINDOW_MS,
  type DayStat,
  type GamiMetric,
  type GamiPeriod,
  type MilestoneRule,
  type OpeningDays,
  type RideTempDay,
} from "./gamification";

export interface GamiConfig {
  enabled: boolean;
  subscriptionIds: number[];
  /** Tagestickets (Service-IDs), deren Gäste die App nutzen dürfen. */
  dayServiceIds: number[];
  startCapPerDay: number;
  /** Fühler (Gerät), der die Wassertemperatur misst; null = keiner gewählt. */
  waterSensorDeviceId: number | null;
  /** Beach Pass für Strandbad-Kunden (lib/rider-pass). */
  beachEnabled: boolean;
  beachSubscriptionIds: number[];
}

const DEFAULT_CONFIG: GamiConfig = {
  enabled: false,
  subscriptionIds: [],
  dayServiceIds: [],
  startCapPerDay: 10,
  waterSensorDeviceId: null,
  beachEnabled: false,
  beachSubscriptionIds: [],
};

// Das Drehkreuz fragt bei jedem Scan: Einstellung kurz im Speicher halten.
const CONFIG_TTL_MS = 60_000;
const configCache = new Map<number, { config: GamiConfig; expiresAt: number }>();

export function invalidateGamiConfig(accountId: number) {
  configCache.delete(accountId);
}

export async function loadGamiConfig(db: TenantDb, accountId: number): Promise<GamiConfig> {
  const hit = configCache.get(accountId);
  if (hit && hit.expiresAt > Date.now()) return hit.config;
  const row = await db.gamificationConfig.findUnique({ where: { accountId } });
  const config: GamiConfig = row
    ? {
        enabled: row.enabled,
        subscriptionIds: row.subscriptionIds,
        dayServiceIds: row.dayServiceIds,
        startCapPerDay: row.startCapPerDay,
        waterSensorDeviceId: row.waterSensorDeviceId,
        beachEnabled: row.beachEnabled,
        beachSubscriptionIds: row.beachSubscriptionIds,
      }
    : DEFAULT_CONFIG;
  configCache.set(accountId, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
  return config;
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function newVoucherCode(): string {
  return `GS-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** Leistungs-Gutschein für ein Ticket anlegen (Meilenstein oder Challenge). */
export function createBenefitVoucher(
  db: TenantDb,
  input: { accountId: number; ticketId: number; label: string; notes: string; validDays: number | null },
) {
  return db.voucher.create({
    data: {
      code: newVoucherCode(),
      kind: "BENEFIT",
      label: input.label,
      ownerTicketId: input.ticketId,
      notes: input.notes,
      expiresAt: input.validDays ? new Date(Date.now() + input.validDays * 86_400_000) : null,
      accountId: input.accountId,
    },
  });
}

/**
 * Einen Start verbuchen: Tagessumme hochzählen und neu erreichte Meilensteine
 * vergeben. Wird vom Scan-Endpunkt nach einem GRANTED-Scan aufgerufen, ohne
 * dass das Drehkreuz darauf wartet.
 */
export async function recordStart(input: {
  accountId: number;
  ticketId: number;
  subscriptionId: number | null;
  /** Tagesticket: zählt nur, wenn der Gast es in der App angemeldet hat. */
  serviceId?: number | null;
  riderProfileId?: number | null;
  /** Fahrer ist ausgestiegen (`Ticket.gamificationOptOut`): nichts zählen. */
  optOut?: boolean;
  at: Date;
  /** Gerät zählt Starts am Lift (`Device.countsAsStart`); fehlt = ja. */
  countsAsStart?: boolean;
  /** Gerät des Scans: für den Beach Pass zählt ein Eintritt am Strandbad-Eingang. */
  deviceId?: number;
}): Promise<void> {
  const { accountId, ticketId, subscriptionId, at } = input;
  if (input.optOut) return;
  const dayGuest = subscriptionId == null && input.serviceId != null && input.riderProfileId != null;
  if (subscriptionId == null && !dayGuest) return;
  const db = tenantClient(accountId);
  const config = await loadGamiConfig(db, accountId);
  if (!config.enabled) return;

  // Beach Pass: Strandbad-Abo, Eintritt am Strandbad-Eingang. Lift-Geräte zählen dafür nicht.
  const beach = isBeachSubscription(config, subscriptionId);
  if (beach) {
    if (input.deviceId == null || !(await beachEntranceIds(accountId)).includes(input.deviceId)) return;
  } else if (input.countsAsStart === false) {
    return;
  }

  if (dayGuest) {
    if (!config.dayServiceIds.includes(input.serviceId!)) return;
    // Tagestickets werden aus ihren Scans neu gezählt (siehe day-guest.ts).
    const ymd = berlinYmd(at);
    await syncDayTicketStat(db, accountId, ticketId);
    await awardMilestones(db, accountId, ticketId, ymd, config.startCapPerDay);
    await runChallenges(db, accountId, ticketId, ymd, config.startCapPerDay);
    return;
  }
  if (!beach && !config.subscriptionIds.includes(subscriptionId!)) return;

  const ymd = berlinYmd(at);
  const day = ymdToDbDate(ymd);
  const count = () =>
    db.riderDayStat.upsert({
      where: { ticketId_day: { ticketId, day } },
      create: { ticketId, day, starts: 1, firstStartAt: at, lastStartAt: at, accountId },
      update: { starts: { increment: 1 }, lastStartAt: at },
    });
  try {
    await count();
  } catch (e) {
    // Zwei Scans legen die Tageszeile gleichzeitig an: der Verlierer zählt danach hoch.
    if (!isUniqueViolation(e)) throw e;
    await count();
  }

  await awardMilestones(db, accountId, ticketId, ymd, config.startCapPerDay);
  await runChallenges(db, accountId, ticketId, ymd, config.startCapPerDay);
}

/** Meilenstein aus der Datenbank als Zählregel (Aktionstage als "YYYY-MM-DD"). */
export function toMilestoneRule(m: {
  id: number;
  metric: string;
  threshold: number;
  period: string;
  eventDays: Date[];
  tempBelow: number | null;
}): MilestoneRule {
  return {
    id: m.id,
    metric: m.metric as GamiMetric,
    threshold: m.threshold,
    period: m.period as GamiPeriod,
    eventDays: m.eventDays.map(dbDateToYmd),
    tempBelow: m.tempBelow,
  };
}

/**
 * Kälteste Wassertemperatur je Besuchstag: der kleinste Mittelwert des
 * Fühlers von einer Stunde vor dem ersten bis eine Stunde nach dem letzten
 * Start der Person. Je nach Alter liegen die Messwerte als 5-Minuten-,
 * Stunden- oder Tagesfenster vor (`climate-history.ts`); ein Tag ohne
 * Messwert fehlt im Ergebnis.
 */
async function loadWaterTemps(
  accountId: number,
  deviceId: number,
  ticketIds: number[],
  sinceYmd: string | null,
): Promise<Map<string, number>> {
  const windowSeconds = Math.round(WATER_WINDOW_MS / 1000);
  const rows = await prisma.$queryRaw<Array<{ day: Date; temp: number | null }>>`
    SELECT r."day" AS day, min(s."tempAvg") AS temp
    FROM "RiderDayStat" r
    CROSS JOIN (VALUES ('MIN5', 300), ('HOUR', 3600), ('DAY', 86400)) AS b(resolution, seconds)
    JOIN "ClimateSample" s
      ON s."deviceId" = ${deviceId}
     AND s."accountId" = ${accountId}
     AND s."resolution" = b.resolution::"ClimateResolution"
     AND s."bucketStart" > r."firstStartAt" - make_interval(secs => ${windowSeconds}::int + b.seconds)
     AND s."bucketStart" <= r."lastStartAt" + make_interval(secs => ${windowSeconds}::int)
    WHERE r."accountId" = ${accountId}
      AND r."ticketId" IN (${Prisma.join(ticketIds)})
      AND r."starts" > 0
      AND r."day" >= ${sinceYmd ?? "1970-01-01"}::date
      AND s."tempAvg" IS NOT NULL
    GROUP BY r."day"`;
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.temp != null) out.set(dbDateToYmd(r.day), Number(r.temp));
  }
  return out;
}

/**
 * Tagessummen einer Person über alle Jahre, je Kalendertag zusammengelegt.
 * Mit `early` wird je Tag gemerkt, ob der erste Start in der ersten Stunde
 * nach dem ersten Abo-Start des Tages am Lift lag (Award „früh am Lift“), mit
 * `water` die Wassertemperatur während der Fahrt (ab dem Tag `since`). Beides
 * kostet je eine weitere Abfrage und läuft nur, wenn ein Meilenstein es
 * braucht.
 */
export async function loadPersonDays(
  db: TenantDb,
  accountId: number,
  ticketIds: number[],
  opts: { early?: boolean; water?: { deviceId: number; since: string | null } } = {},
): Promise<DayStat[]> {
  if (ticketIds.length === 0) return [];
  const withEarly = opts.early === true;
  const [stats, water] = await Promise.all([
    db.riderDayStat.findMany({
      where: { accountId, ticketId: { in: ticketIds } },
      select: { day: true, starts: true, firstStartAt: true },
    }),
    opts.water ? loadWaterTemps(accountId, opts.water.deviceId, ticketIds, opts.water.since) : null,
  ]);
  const firstOfDay = new Map<string, number>();
  if (withEarly && stats.length > 0) {
    const days = [...new Set(stats.map((s) => s.day.getTime()))].map((t) => new Date(t));
    const rows = await db.riderDayStat.groupBy({
      by: ["day"],
      // Nur Abos: ein Tagesticket ohne Scan trägt als Zeit den Beginn des Tickets.
      where: { accountId, day: { in: days }, ticket: { subscriptionId: { not: null } } },
      _min: { firstStartAt: true },
    });
    for (const r of rows) {
      if (r._min.firstStartAt) firstOfDay.set(dbDateToYmd(r.day), r._min.firstStartAt.getTime());
    }
  }
  return mergeDayStats(
    stats.map((s) => {
      const day = dbDateToYmd(s.day);
      const first = firstOfDay.get(day);
      const delay = first == null ? null : s.firstStartAt.getTime() - first;
      return {
        day,
        starts: s.starts,
        early: delay != null && delay >= 0 && delay <= EARLY_WINDOW_MS,
        waterTemp: water?.get(day),
      };
    }),
  );
}

/**
 * Erster Tag der Saison je Jahr: der erste Tag, an dem ein Abo-Ticket
 * gestartet ist. Tagestickets zählen nicht mit, weil ein Ticket ohne Scan als
 * Tag den Beginn des Tickets trägt. Für das Jahr, in dem die Zählung begonnen
 * hat, gibt es keinen Tag: die Saison lief da schon, der erste gezählte Tag
 * ist nicht der erste Tag der Saison (2026 beginnt die Zählung am 09.05.).
 */
export async function loadOpeningDays(db: TenantDb, accountId: number, years: string[]): Promise<OpeningDays> {
  const firstStart = (day?: { gte: Date; lte: Date }) =>
    db.riderDayStat.findFirst({
      where: { accountId, starts: { gt: 0 }, ...(day && { day }), ticket: { subscriptionId: { not: null } } },
      orderBy: { day: "asc" },
      select: { day: true },
    });
  const out: Record<string, string> = {};
  const counted = await firstStart();
  if (!counted) return out;
  const countedSince = dbDateToYmd(counted.day).slice(0, 4);
  await Promise.all(
    years
      .filter((year) => year > countedSince)
      .map(async (year) => {
        const first = await firstStart({ gte: ymdToDbDate(`${year}-01-01`), lte: ymdToDbDate(`${year}-12-31`) });
        if (first) out[year] = dbDateToYmd(first.day);
      }),
  );
  return out;
}

/** Was die Zählregeln einer Person brauchen: ihre Tagessummen und der erste Tag der Saison je Jahr. */
/**
 * Luft- und Wassertemperatur je Besuchstag eines Jahres, gemittelt über die
 * Zeit am Lift (erster bis letzter Start der Person). Luft: Stundenwerte des
 * Wetterdienstes (`WeatherHour`, lib/weather-history.ts). Wasser: der Fühler
 * der Kunden-App (`ClimateSample`, je nach Alter 5 Minuten, Stunden oder
 * Tage). Ein Tag ohne Messwert trägt null.
 */
export async function loadRideTemps(
  accountId: number,
  ticketIds: number[],
  year: number,
  waterDeviceId: number | null,
): Promise<RideTempDay[]> {
  if (ticketIds.length === 0) return [];
  const rows = await prisma.$queryRaw<Array<{ day: Date; air: number | null; water: number | null }>>`
    WITH d AS (
      SELECT r."day" AS day, min(r."firstStartAt") AS first, max(r."lastStartAt") AS last
      FROM "RiderDayStat" r
      WHERE r."accountId" = ${accountId}
        AND r."ticketId" IN (${Prisma.join(ticketIds)})
        AND r."starts" > 0
        AND r."day" >= ${`${year}-01-01`}::date
        AND r."day" <= ${`${year}-12-31`}::date
      GROUP BY r."day"
    )
    SELECT d.day,
      (SELECT avg(w."temp")
         FROM "WeatherHour" w
        WHERE w."accountId" = ${accountId}
          AND w."hour" > d.first - interval '1 hour'
          AND w."hour" <= d.last) AS air,
      (SELECT sum(s."tempAvg" * b.seconds) / sum(b.seconds)
         FROM (VALUES ('MIN5', 300), ('HOUR', 3600), ('DAY', 86400)) AS b(resolution, seconds)
         JOIN "ClimateSample" s
           ON s."deviceId" = ${waterDeviceId ?? -1}
          AND s."accountId" = ${accountId}
          AND s."resolution" = b.resolution::"ClimateResolution"
          AND s."bucketStart" > d.first - make_interval(secs => b.seconds)
          AND s."bucketStart" <= d.last
        WHERE s."tempAvg" IS NOT NULL) AS water
    FROM d
    ORDER BY d.day`;
  return rows.map((r) => ({ day: dbDateToYmd(r.day), air: r.air, water: r.water }));
}

export interface RuleData {
  days: DayStat[];
  openingDays: OpeningDays;
}

/**
 * Tagessummen und Zusatzdaten für die aktiven Meilensteine laden. Frühstart,
 * Wassertemperatur und erster Tag der Saison werden nur abgefragt, wenn ein
 * Meilenstein danach zählt; die Wassertemperatur nur für den Zeitraum, den
 * diese Meilensteine ansehen.
 */
export async function loadRuleData(
  db: TenantDb,
  accountId: number,
  ticketIds: number[],
  milestones: Array<{ metric: string; period: string }>,
  refYmd: string,
): Promise<RuleData> {
  const year = refYmd.slice(0, 4);
  const cold = milestones.filter((m) => m.metric === "COLD_DAYS");
  const opening = milestones.filter((m) => m.metric === "OPENING_DAY");
  const sensorId = cold.length > 0 ? (await loadGamiConfig(db, accountId)).waterSensorDeviceId : null;
  const since = cold.some((m) => m.period === "ALL_TIME")
    ? null
    : cold.some((m) => m.period === "SEASON")
      ? `${year}-01-01`
      : `${refYmd.slice(0, 7)}-01`;
  const days = await loadPersonDays(db, accountId, ticketIds, {
    early: milestones.some((m) => m.metric === "EARLY_DAYS"),
    water: sensorId != null ? { deviceId: sensorId, since } : undefined,
  });
  if (opening.length === 0) return { days, openingDays: {} };
  const years = new Set([year]);
  if (opening.some((m) => m.period === "ALL_TIME")) {
    for (const d of days) years.add(d.day.slice(0, 4));
  }
  return { days, openingDays: await loadOpeningDays(db, accountId, [...years]) };
}

/** Zuletzt gemessene Wassertemperatur in °C (höchstens drei Stunden alt), sonst null. */
export async function loadWaterNow(accountId: number, now: Date = new Date()): Promise<number | null> {
  const config = await loadGamiConfig(tenantClient(accountId), accountId);
  if (config.waterSensorDeviceId == null) return null;
  const sample = await prisma.climateSample.findFirst({
    where: {
      accountId,
      deviceId: config.waterSensorDeviceId,
      resolution: "MIN5",
      tempAvg: { not: null },
      bucketStart: { gte: new Date(now.getTime() - 3 * 3_600_000) },
    },
    orderBy: { bucketStart: "desc" },
    select: { tempAvg: true },
  });
  return sample?.tempAvg ?? null;
}

/** Herkunft eines Gutscheins aus einem Award, so steht sie am Gutschein. */
export function awardVoucherNote(name: string, periodKey: string): string {
  return periodKey === ALL_TIME_KEY ? `Award ${name}` : `Award ${name} (${periodKey})`;
}

/** Namensräume für pg_advisory_xact_lock(int, int): eine Vergabe je Person bzw. Ticket zugleich. */
const AWARD_LOCK_PERSON = 7302;
const AWARD_LOCK_TICKET = 7303;

/**
 * Award anlegen, wenn die Person ihn in diesem Zeitraum noch nicht hat;
 * liefert die ID oder null. Die Sperre je Person verhindert, dass ein Scan am
 * Drehkreuz und das Öffnen der App denselben Award gleichzeitig auf zwei
 * Tickets vergeben: die Eindeutigkeit in der Datenbank gilt nur je Ticket.
 */
async function claimAward(input: {
  accountId: number;
  milestoneId: number;
  ticketId: number;
  /** Alle Tickets der Person. */
  ticketIds: number[];
  periodKey: string;
  profileId: number | null;
}): Promise<number | null> {
  const { accountId, milestoneId, ticketId, periodKey } = input;
  return prisma.$transaction(async (tx) => {
    if (input.profileId != null) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AWARD_LOCK_PERSON}::int, ${input.profileId}::int)`;
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AWARD_LOCK_TICKET}::int, ${ticketId}::int)`;
    }
    const has = await tx.milestoneAward.findFirst({
      where: { accountId, milestoneId, periodKey, ticketId: { in: input.ticketIds } },
      select: { id: true },
    });
    if (has) return null;
    const award = await tx.milestoneAward.create({
      data: { milestoneId, ticketId, periodKey, accountId },
      select: { id: true },
    });
    return award.id;
  });
}

/**
 * Neu erreichte Meilensteine (Awards) eines Tickets vergeben; gibt die Anzahl
 * zurück. Gezählt wird je Person über alle Jahre: Awards ohne Zeitraum
 * (Starts gesamt, Saisons) gibt es einmal, die anderen je Saison oder Monat.
 * `notify: false` verschickt keine Push-Nachricht (die App ist gerade offen).
 */
export async function awardMilestones(
  db: TenantDb,
  accountId: number,
  ticketId: number,
  refYmd: string,
  capPerDay: number,
  opts: { notify?: boolean } = {},
): Promise<number> {
  // Meilensteine gelten je Person: alle Tickets desselben Profils zählen zusammen.
  const owner = await db.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: { riderProfileId: true, subscriptionId: true, status: true, endDate: true, riderProfile: { select: { ridingSince: true } } },
  });
  const siblings = owner?.riderProfileId
    ? await db.ticket.findMany({
        where: { accountId, riderProfileId: owner.riderProfileId },
        select: { id: true, subscriptionId: true, status: true, endDate: true },
      })
    : [];
  const ticketIds = siblings.length > 0 ? siblings.map((t) => t.id) : [ticketId];

  // Nur Awards für den Pass der Person (Ride Pass oder Beach Pass).
  const config = await loadGamiConfig(db, accountId);
  const kind = passKindOf(siblings.length > 0 ? siblings : owner ? [owner] : [], config);
  const milestones = await db.milestone.findMany({ where: { accountId, active: true, audience: { in: audiencesFor(kind) } } });
  if (milestones.length === 0) return 0;

  const [{ days, openingDays }, awards] = await Promise.all([
    loadRuleData(db, accountId, ticketIds, milestones, refYmd),
    db.milestoneAward.findMany({
      where: { accountId, ticketId: { in: ticketIds } },
      select: { milestoneId: true, periodKey: true },
    }),
  ]);

  const awarded = new Set(awards.map((a) => awardKey(a.milestoneId, a.periodKey)));
  const seasons = seasonsCount(days, owner?.riderProfile?.ridingSince ?? null, refYmd);
  const reached = reachedMilestones(milestones.map(toMilestoneRule), days, refYmd, capPerDay, awarded, seasons, openingDays);

  let created = 0;
  for (const r of reached) {
    const milestone = milestones.find((m) => m.id === r.milestoneId);
    if (!milestone) continue;
    try {
      // Erst der Award (einmal je Person und Zeitraum): verliert ein paralleler
      // Scan das Rennen, entsteht kein zweiter Gutschein.
      const awardId = await claimAward({
        accountId,
        milestoneId: milestone.id,
        ticketId,
        ticketIds,
        periodKey: r.periodKey,
        profileId: owner?.riderProfileId ?? null,
      });
      if (awardId == null) continue;
      created += 1;
      if (milestone.voucherLabel) {
        const voucher = await createBenefitVoucher(db, {
          accountId,
          ticketId,
          label: milestone.voucherLabel,
          notes: awardVoucherNote(milestone.name, r.periodKey),
          validDays: milestone.voucherValidDays,
        });
        await db.milestoneAward.update({ where: { id: awardId }, data: { voucherId: voucher.id } });
      }
      if (milestone.skillId) {
        await grantSkill(db, {
          accountId,
          ticketId,
          skillId: milestone.skillId,
          uses: milestone.skillUses,
          validDays: milestone.skillValidDays,
          source: awardVoucherNote(milestone.name, r.periodKey),
        }).catch((e) => console.error("[awards] Skill vergeben fehlgeschlagen:", e));
      }
      if (opts.notify !== false) notifyAward(accountId, ticketId, milestone.name, milestone.voucherLabel);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return created;
}

export type RedeemResult =
  | { ok: true; label: string; code: string }
  | { ok: false; message: string };

/**
 * Leistungs-Gutschein entwerten. Atomar: von zwei gleichzeitigen Versuchen
 * gewinnt genau einer.
 */
export async function redeemBenefitVoucher(
  db: TenantDb,
  accountId: number,
  voucher: {
    id: number;
    code: string;
    label: string | null;
    redeemedAt: Date | null;
    disabledAt: Date | null;
    expiresAt: Date | null;
  },
  via: "ADMIN" | "CHECKIN" | "KASSE",
): Promise<RedeemResult> {
  const state = benefitVoucherState(voucher);
  if (state !== "open") return { ok: false, message: BENEFIT_STATE_MESSAGE[state] };
  const res = await db.voucher.updateMany({
    where: { id: voucher.id, accountId, kind: "BENEFIT", redeemedAt: null, disabledAt: null },
    data: { redeemedAt: new Date(), redeemedVia: via },
  });
  if (res.count === 0) return { ok: false, message: BENEFIT_STATE_MESSAGE.redeemed };
  return { ok: true, label: voucher.label ?? "Gutschein", code: voucher.code };
}

/**
 * Tagessummen eines Jahres aus den vorhandenen Scans neu berechnen. Vergibt
 * keine Meilensteine und keine Gutscheine – das passiert erst beim nächsten
 * Start des Tickets.
 */
export async function backfillYear(
  db: TenantDb,
  accountId: number,
  year: number,
): Promise<{ scans: number; days: number; tickets: number }> {
  const config = await db.gamificationConfig.findUnique({ where: { accountId } });
  const devices = await db.device.findMany({
    where: { accountId, countsAsStart: true },
    select: { id: true },
  });
  const subscriptionIds = config?.subscriptionIds ?? [];
  const from = new Date(`${year}-01-01T00:00:00+01:00`);
  const to = new Date(`${year + 1}-01-01T00:00:00+01:00`);

  const scans: Array<{ ticketId: number; scanTime: Date }> = [];
  if (devices.length > 0 && subscriptionIds.length > 0) {
    const PAGE = 5000;
    let cursor = 0;
    for (;;) {
      const page = await db.scan.findMany({
        where: {
          accountId,
          id: { gt: cursor },
          result: "GRANTED",
          deviceId: { in: devices.map((d) => d.id) },
          scanTime: { gte: from, lt: to },
          ticket: { subscriptionId: { in: subscriptionIds } },
        },
        select: { id: true, ticketId: true, scanTime: true },
        orderBy: { id: "asc" },
        take: PAGE,
      });
      for (const s of page) {
        if (s.ticketId != null) scans.push({ ticketId: s.ticketId, scanTime: s.scanTime });
      }
      if (page.length < PAGE) break;
      cursor = page[page.length - 1].id;
    }
  }

  // Beach Pass: Eintritte am Strandbad-Eingang mit einem Strandbad-Abo.
  const beachSubs = config?.beachEnabled
    ? beachOnlySubscriptionIds({ beachEnabled: true, subscriptionIds, beachSubscriptionIds: config.beachSubscriptionIds })
    : [];
  const entrances = beachSubs.length > 0 ? await beachEntranceIds(accountId) : [];
  if (beachSubs.length > 0 && entrances.length > 0) {
    const PAGE = 5000;
    let cursor = 0;
    for (;;) {
      const page = await db.scan.findMany({
        where: {
          accountId,
          id: { gt: cursor },
          result: "GRANTED",
          deviceId: { in: entrances },
          scanTime: { gte: from, lt: to },
          ticket: { subscriptionId: { in: beachSubs } },
        },
        select: { id: true, ticketId: true, scanTime: true },
        orderBy: { id: "asc" },
        take: PAGE,
      });
      for (const s of page) {
        if (s.ticketId != null) scans.push({ ticketId: s.ticketId, scanTime: s.scanTime });
      }
      if (page.length < PAGE) break;
      cursor = page[page.length - 1].id;
    }
  }

  const rows = aggregateScans(scans);
  const range = { gte: ymdToDbDate(`${year}-01-01`), lte: ymdToDbDate(`${year}-12-31`) };
  await db.$transaction([
    db.riderDayStat.deleteMany({ where: { accountId, day: range } }),
    db.riderDayStat.createMany({
      data: rows.map((r) => ({
        ticketId: r.ticketId,
        day: ymdToDbDate(r.day),
        starts: r.starts,
        firstStartAt: r.firstStartAt,
        lastStartAt: r.lastStartAt,
        accountId,
      })),
    }),
  ]);

  return { scans: scans.length, days: rows.length, tickets: new Set(rows.map((r) => r.ticketId)).size };
}

/**
 * Tagessummen eines Tagestickets aus seinen Scans neu aufbauen. Ein Ticket
 * ohne Scan am Start-Gerät zählt trotzdem als ein Besuchstag mit einem Start:
 * nicht jede Bahn hat ein Drehkreuz.
 */
export async function syncDayTicketStat(db: TenantDb, accountId: number, ticketId: number): Promise<void> {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: { id: true, startDate: true, createdAt: true },
  });
  if (!ticket) return;
  const scans = await db.scan.findMany({
    where: { accountId, ticketId, result: "GRANTED", device: { countsAsStart: true } },
    select: { scanTime: true },
    take: 2000,
  });
  const at = ticket.startDate ?? ticket.createdAt;
  const rows =
    scans.length > 0
      ? aggregateScans(scans.map((s) => ({ ticketId, scanTime: s.scanTime })))
      : [{ ticketId, day: berlinYmd(at), starts: 1, firstStartAt: at, lastStartAt: at }];
  await db.$transaction([
    db.riderDayStat.deleteMany({ where: { accountId, ticketId } }),
    db.riderDayStat.createMany({
      data: rows.map((r) => ({
        ticketId,
        day: ymdToDbDate(r.day),
        starts: r.starts,
        firstStartAt: r.firstStartAt,
        lastStartAt: r.lastStartAt,
        accountId,
      })),
    }),
  ]);
}
