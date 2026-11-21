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
  type DayStat,
  type GamiMetric,
  type GamiPeriod,
  type MilestoneRule,
} from "./gamification";

export interface GamiConfig {
  enabled: boolean;
  subscriptionIds: number[];
  /** Tagestickets (Service-IDs), deren Gäste die App nutzen dürfen. */
  dayServiceIds: number[];
  startCapPerDay: number;
}

const DEFAULT_CONFIG: GamiConfig = { enabled: false, subscriptionIds: [], dayServiceIds: [], startCapPerDay: 10 };

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
}): Promise<void> {
  const { accountId, ticketId, subscriptionId, at } = input;
  if (input.optOut) return;
  const dayGuest = subscriptionId == null && input.serviceId != null && input.riderProfileId != null;
  if (subscriptionId == null && !dayGuest) return;
  const db = tenantClient(accountId);
  const config = await loadGamiConfig(db, accountId);
  if (!config.enabled) return;

  if (dayGuest) {
    if (!config.dayServiceIds.includes(input.serviceId!)) return;
    // Tagestickets werden aus ihren Scans neu gezählt (siehe day-guest.ts).
    const ymd = berlinYmd(at);
    await syncDayTicketStat(db, accountId, ticketId);
    await awardMilestones(db, accountId, ticketId, ymd, config.startCapPerDay);
    await runChallenges(db, accountId, ticketId, ymd, config.startCapPerDay);
    return;
  }
  if (!config.subscriptionIds.includes(subscriptionId!)) return;

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
}): MilestoneRule {
  return {
    id: m.id,
    metric: m.metric as GamiMetric,
    threshold: m.threshold,
    period: m.period as GamiPeriod,
    eventDays: m.eventDays.map(dbDateToYmd),
  };
}

/**
 * Tagessummen einer Person über alle Jahre, je Kalendertag zusammengelegt.
 * Mit `withEarly` wird je Tag gemerkt, ob der erste Start in der ersten
 * Stunde nach dem ersten Abo-Start des Tages am Lift lag (Award „früh am
 * Lift“). Das kostet eine zweite Abfrage und läuft nur, wenn ein Meilenstein
 * es braucht.
 */
export async function loadPersonDays(
  db: TenantDb,
  accountId: number,
  ticketIds: number[],
  withEarly: boolean,
): Promise<DayStat[]> {
  if (ticketIds.length === 0) return [];
  const stats = await db.riderDayStat.findMany({
    where: { accountId, ticketId: { in: ticketIds } },
    select: { day: true, starts: true, firstStartAt: true },
  });
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
      return { day, starts: s.starts, early: delay != null && delay >= 0 && delay <= EARLY_WINDOW_MS };
    }),
  );
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
  const milestones = await db.milestone.findMany({ where: { accountId, active: true } });
  if (milestones.length === 0) return 0;

  // Meilensteine gelten je Person: alle Tickets desselben Profils zählen zusammen.
  const owner = await db.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: { riderProfileId: true, riderProfile: { select: { ridingSince: true } } },
  });
  const ticketIds = owner?.riderProfileId
    ? (await db.ticket.findMany({ where: { accountId, riderProfileId: owner.riderProfileId }, select: { id: true } })).map((t) => t.id)
    : [ticketId];

  const [days, awards] = await Promise.all([
    loadPersonDays(db, accountId, ticketIds, milestones.some((m) => m.metric === "EARLY_DAYS")),
    db.milestoneAward.findMany({
      where: { accountId, ticketId: { in: ticketIds } },
      select: { milestoneId: true, periodKey: true },
    }),
  ]);

  const awarded = new Set(awards.map((a) => awardKey(a.milestoneId, a.periodKey)));
  const seasons = seasonsCount(days, owner?.riderProfile?.ridingSince ?? null, refYmd);
  const reached = reachedMilestones(milestones.map(toMilestoneRule), days, refYmd, capPerDay, awarded, seasons);

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
