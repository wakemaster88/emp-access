/**
 * Challenges: Stand je Fahrer berechnen und Gewinne vergeben.
 *
 * Gezählt wird je Person: Tickets mit gemeinsamem Kunden-App-Profil
 * (`Ticket.riderProfileId`) bilden eine Einheit, ein Ticket ohne Profil steht
 * für sich. Der Gewinn hängt am jüngsten Ticket der Einheit.
 */
import type { TenantDb } from "./prisma";
import {
  challengeCountsRides,
  challengeSettlesAtEnd,
  challengeValue,
  dbDateToYmd,
  mergeDayStats,
  rankStandings,
  type ChallengeKind,
  type DayStat,
  type GamiMetric,
  type Standing,
} from "./gamification";
import { createBenefitVoucher, isUniqueViolation } from "./gamification-service";
import { notifyVoucher } from "./rider-push";

export interface ChallengeRow {
  id: number;
  name: string;
  kind: ChallengeKind;
  metric: GamiMetric;
  threshold: number | null;
  topCount: number | null;
  startDate: Date;
  endDate: Date;
  voucherLabel: string | null;
  voucherValidDays: number | null;
}

export interface RiderUnit {
  /** "p<profilId>" oder "t<ticketId>". */
  key: string;
  profileId: number | null;
  ticketIds: number[];
  /** Ticket, an dem ein Gewinn hängt (das jüngste der Einheit). */
  awardTicketId: number;
  value: number;
}

function range(c: ChallengeRow) {
  return { metric: c.metric, startYmd: dbDateToYmd(c.startDate), endYmd: dbDateToYmd(c.endDate) };
}

/** Stand aller Fahrer in einer Challenge, unsortiert. Fahrer ohne Start im Zeitraum fehlen. */
export async function challengeUnits(
  db: TenantDb,
  accountId: number,
  c: ChallengeRow,
  capPerDay: number,
): Promise<RiderUnit[]> {
  // Foto und Abstimmung zählen keine Starts.
  if (!challengeCountsRides(c.kind)) return [];
  const stats = await db.riderDayStat.findMany({
    where: { accountId, day: { gte: c.startDate, lte: c.endDate }, ticket: { gamificationOptOut: false } },
    select: { ticketId: true, day: true, starts: true, ticket: { select: { riderProfileId: true } } },
  });
  const units = new Map<string, { profileId: number | null; ticketIds: Set<number>; days: DayStat[] }>();
  for (const s of stats) {
    const profileId = s.ticket.riderProfileId;
    const key = profileId != null ? `p${profileId}` : `t${s.ticketId}`;
    let u = units.get(key);
    if (!u) {
      u = { profileId, ticketIds: new Set(), days: [] };
      units.set(key, u);
    }
    u.ticketIds.add(s.ticketId);
    u.days.push({ day: dbDateToYmd(s.day), starts: s.starts });
  }
  const r = range(c);
  return [...units.entries()].map(([key, u]) => {
    const ticketIds = [...u.ticketIds].sort((a, b) => a - b);
    return {
      key,
      profileId: u.profileId,
      ticketIds,
      awardTicketId: ticketIds[ticketIds.length - 1],
      value: challengeValue(mergeDayStats(u.days), r, capPerDay),
    };
  });
}

/** Rangliste einer Top-X-Challenge mit den Einheiten dahinter. */
export function rankUnits(units: RiderUnit[], topCount: number): Array<Standing<string> & { unit: RiderUnit }> {
  const byKey = new Map(units.map((u) => [u.key, u]));
  return rankStandings(units.map((u) => ({ key: u.key, value: u.value })), topCount).map((s) => ({
    ...s,
    unit: byKey.get(s.key)!,
  }));
}

async function award(
  db: TenantDb,
  accountId: number,
  c: ChallengeRow,
  ticketId: number,
  rank: number | null,
): Promise<boolean> {
  try {
    // Erst der Award (eindeutig je Challenge und Ticket), dann der Gutschein.
    const created = await db.challengeAward.create({
      data: { challengeId: c.id, ticketId, rank, accountId },
    });
    if (c.voucherLabel) {
      const voucher = await createBenefitVoucher(db, {
        accountId,
        ticketId,
        label: c.voucherLabel,
        notes: rank != null ? `Challenge ${c.name} (Platz ${rank})` : `Challenge ${c.name}`,
        validDays: c.voucherValidDays,
      });
      await db.challengeAward.update({ where: { id: created.id }, data: { voucherId: voucher.id } });
      notifyVoucher(accountId, ticketId, c.voucherLabel);
    }
    return true;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return false;
  }
}

/**
 * Laufende Aufgaben-Challenges für die Person hinter `ticketId` prüfen und
 * bei erreichter Schwelle einmal vergeben.
 */
export async function awardTaskChallenges(
  db: TenantDb,
  accountId: number,
  ticketId: number,
  refYmd: string,
  capPerDay: number,
  challenges: ChallengeRow[],
): Promise<number> {
  const running = challenges.filter((c) => {
    const r = range(c);
    return c.kind === "TASK" && (c.threshold ?? 0) > 0 && r.startYmd <= refYmd && refYmd <= r.endYmd;
  });
  if (running.length === 0) return 0;

  const ticket = await db.ticket.findFirst({ where: { id: ticketId, accountId }, select: { riderProfileId: true } });
  if (!ticket) return 0;
  const siblings =
    ticket.riderProfileId != null
      ? await db.ticket.findMany({
          where: { accountId, riderProfileId: ticket.riderProfileId },
          select: { id: true },
        })
      : [];
  const ticketIds = [...new Set([ticketId, ...siblings.map((t) => t.id)])];
  const first = running.reduce((min, c) => (c.startDate < min ? c.startDate : min), running[0].startDate);
  const last = running.reduce((max, c) => (c.endDate > max ? c.endDate : max), running[0].endDate);

  const [stats, awards] = await Promise.all([
    db.riderDayStat.findMany({
      where: { accountId, ticketId: { in: ticketIds }, day: { gte: first, lte: last } },
      select: { day: true, starts: true },
    }),
    db.challengeAward.findMany({
      where: { accountId, ticketId: { in: ticketIds }, challengeId: { in: running.map((c) => c.id) } },
      select: { challengeId: true },
    }),
  ]);
  const days = mergeDayStats(stats.map((s) => ({ day: dbDateToYmd(s.day), starts: s.starts })));
  const done = new Set(awards.map((a) => a.challengeId));

  let created = 0;
  for (const c of running) {
    if (done.has(c.id)) continue;
    if (challengeValue(days, range(c), capPerDay) < (c.threshold ?? 0)) continue;
    if (await award(db, accountId, c, ticketId, null)) created += 1;
  }
  return created;
}

/**
 * Foto-Challenge: die sichtbaren Fotos nach Stimmen; Gewinner wie bei Top X
 * (Gleichstand auf dem letzten Gewinnerplatz: alle). Ohne Stimme kein Platz.
 */
export async function photoStandings(
  db: TenantDb,
  accountId: number,
  challengeId: number,
  topCount: number,
): Promise<Array<Standing<number> & { profileId: number }>> {
  const entries = await db.challengeEntry.findMany({
    where: { accountId, challengeId, hidden: false },
    select: { id: true, profileId: true, _count: { select: { votes: true } } },
  });
  const byId = new Map(entries.map((e) => [e.id, e.profileId]));
  return rankStandings(entries.map((e) => ({ key: e.id, value: e._count.votes })), topCount).map((s) => ({
    ...s,
    profileId: byId.get(s.key)!,
  }));
}

/** Gewinn einer Person: am jüngsten Ticket ihres Profils; ohne Ticket nichts. */
async function awardProfile(db: TenantDb, accountId: number, c: ChallengeRow, profileId: number, rank: number): Promise<boolean> {
  const ticket = await db.ticket.findFirst({
    where: { accountId, riderProfileId: profileId },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  return ticket ? award(db, accountId, c, ticket.id, rank) : false;
}

/**
 * Beendete Top-X- und Foto-Challenges auswerten. Jede Challenge wird genau einmal
 * ausgewertet: `settledAt` wird atomar gesetzt, bevor Gewinne entstehen.
 */
export async function settleChallenges(
  db: TenantDb,
  accountId: number,
  todayYmd: string,
  capPerDay: number,
  challenges: ChallengeRow[],
): Promise<number> {
  let settled = 0;
  for (const c of challenges) {
    if (!challengeSettlesAtEnd(c.kind) || dbDateToYmd(c.endDate) >= todayYmd) continue;
    const claim = await db.challenge.updateMany({
      where: { id: c.id, accountId, settledAt: null },
      data: { settledAt: new Date() },
    });
    if (claim.count === 0) continue;
    settled += 1;
    if (c.kind === "PHOTO") {
      for (const s of await photoStandings(db, accountId, c.id, c.topCount ?? 1)) {
        if (s.winner) await awardProfile(db, accountId, c, s.profileId, s.rank);
      }
      continue;
    }
    const ranked = rankUnits(await challengeUnits(db, accountId, c, capPerDay), c.topCount ?? 0);
    for (const s of ranked) {
      if (s.winner) await award(db, accountId, c, s.unit.awardTicketId, s.rank);
    }
  }
  return settled;
}

/** Aktive, noch nicht ausgewertete Challenges eines Mandanten. */
export function openChallenges(db: TenantDb, accountId: number): Promise<ChallengeRow[]> {
  return db.challenge.findMany({
    where: { accountId, active: true, settledAt: null },
  }) as Promise<ChallengeRow[]>;
}

/** Nach einem Start: Aufgaben prüfen und fällige Top-X-Challenges auswerten. */
export async function runChallenges(
  db: TenantDb,
  accountId: number,
  ticketId: number,
  refYmd: string,
  capPerDay: number,
): Promise<void> {
  const challenges = await openChallenges(db, accountId);
  if (challenges.length === 0) return;
  await awardTaskChallenges(db, accountId, ticketId, refYmd, capPerDay, challenges);
  await settleChallenges(db, accountId, refYmd, capPerDay, challenges);
}

/** Fällige Auswertungen ohne Start anstoßen (Verwaltung, Kunden-App). */
export async function settleDueChallenges(
  db: TenantDb,
  accountId: number,
  todayYmd: string,
  capPerDay: number,
): Promise<number> {
  const due = await db.challenge.findMany({
    where: { accountId, active: true, settledAt: null, kind: { in: ["TOP_X", "PHOTO"] } },
  });
  return settleChallenges(db, accountId, todayYmd, capPerDay, due as ChallengeRow[]);
}
