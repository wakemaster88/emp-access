/**
 * Gamification: Datenbank-Seite (Tagessummen schreiben, Meilensteine vergeben,
 * Leistungs-Gutscheine entwerten, Rückrechnung). Die Rechenlogik steht in
 * `gamification.ts`.
 */
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { tenantClient, type TenantDb } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { runChallenges } from "./challenge-service";
import {
  aggregateScans,
  awardKey,
  benefitVoucherState,
  dbDateToYmd,
  reachedMilestones,
  ymdToDbDate,
  BENEFIT_STATE_MESSAGE,
} from "./gamification";

export interface GamiConfig {
  enabled: boolean;
  subscriptionIds: number[];
  startCapPerDay: number;
}

const DEFAULT_CONFIG: GamiConfig = { enabled: false, subscriptionIds: [], startCapPerDay: 10 };

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
    ? { enabled: row.enabled, subscriptionIds: row.subscriptionIds, startCapPerDay: row.startCapPerDay }
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
  /** Fahrer ist ausgestiegen (`Ticket.gamificationOptOut`): nichts zählen. */
  optOut?: boolean;
  at: Date;
}): Promise<void> {
  const { accountId, ticketId, subscriptionId, at } = input;
  if (subscriptionId == null || input.optOut) return;
  const db = tenantClient(accountId);
  const config = await loadGamiConfig(db, accountId);
  if (!config.enabled || !config.subscriptionIds.includes(subscriptionId)) return;

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

/** Neu erreichte Meilensteine eines Tickets vergeben; gibt die Anzahl zurück. */
export async function awardMilestones(
  db: TenantDb,
  accountId: number,
  ticketId: number,
  refYmd: string,
  capPerDay: number,
): Promise<number> {
  const milestones = await db.milestone.findMany({ where: { accountId, active: true } });
  if (milestones.length === 0) return 0;

  const year = refYmd.slice(0, 4);
  const [stats, awards] = await Promise.all([
    db.riderDayStat.findMany({
      where: {
        accountId,
        ticketId,
        day: { gte: ymdToDbDate(`${year}-01-01`), lte: ymdToDbDate(`${year}-12-31`) },
      },
      select: { day: true, starts: true },
    }),
    db.milestoneAward.findMany({
      where: { accountId, ticketId, periodKey: { startsWith: year } },
      select: { milestoneId: true, periodKey: true },
    }),
  ]);

  const awarded = new Set(awards.map((a) => awardKey(a.milestoneId, a.periodKey)));
  const days = stats.map((s) => ({ day: dbDateToYmd(s.day), starts: s.starts }));
  const reached = reachedMilestones(milestones, days, refYmd, capPerDay, awarded);

  let created = 0;
  for (const r of reached) {
    const milestone = milestones.find((m) => m.id === r.milestoneId);
    if (!milestone) continue;
    try {
      // Erst der Award (eindeutig je Meilenstein/Ticket/Zeitraum): verliert ein
      // paralleler Scan das Rennen, entsteht kein zweiter Gutschein.
      const award = await db.milestoneAward.create({
        data: { milestoneId: milestone.id, ticketId, periodKey: r.periodKey, accountId },
      });
      created += 1;
      if (milestone.voucherLabel) {
        const voucher = await createBenefitVoucher(db, {
          accountId,
          ticketId,
          label: milestone.voucherLabel,
          notes: `Meilenstein ${milestone.name} (${r.periodKey})`,
          validDays: milestone.voucherValidDays,
        });
        await db.milestoneAward.update({ where: { id: award.id }, data: { voucherId: voucher.id } });
      }
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
  via: "ADMIN" | "CHECKIN",
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
