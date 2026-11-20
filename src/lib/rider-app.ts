/**
 * Kunden-App (`/app/<token>`): Profil laden, anlegen und löschen.
 *
 * Ein Profil bündelt alle Abo-Tickets einer Person, weil eine Verlängerung
 * teils ein neues Ticket anlegt. Der Token im Link ist die Berechtigung.
 */
import { randomBytes } from "node:crypto";
import { cache } from "react";
import { prisma } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { adoptDayTickets } from "./day-guest";
import {
  benefitVoucherState,
  computeMetrics,
  currentWeekStreak,
  dbDateToYmd,
  aboCalculation,
  aheadOfPercent,
  parsePriceMap,
  mergeDayStats,
  seasonRecap,
  milestoneProgress,
  seasonLevel,
  ymdToDbDate,
  type AboCalculation,
  type BenefitVoucherState,
  type GamiMetric,
  type GamiPeriod,
  type MilestoneProgress,
  type SeasonRecap,
} from "./gamification";

export function newRiderToken(): string {
  return randomBytes(18).toString("base64url");
}

export function riderAppPath(token: string): string {
  return `/app/${encodeURIComponent(token)}`;
}

export interface RiderVoucher {
  id: number;
  code: string;
  label: string;
  source: string | null;
  state: BenefitVoucherState;
  expiresAt: Date | null;
  redeemedAt: Date | null;
}

export interface RiderView {
  profileId: number;
  accountId: number;
  accountName: string;
  ticketIds: number[];
  firstName: string;
  nickname: string | null;
  showInRanking: boolean;
  enabled: boolean;
  startCapPerDay: number;
  abo: { name: string; endDate: Date | null; active: boolean; areas: string[] } | null;
  /** Tagesgast ohne Abo: sieht den Abo-Rechner. */
  dayGuest: boolean;
  /** Abo-Rechner; null, solange nicht jede Zahl dafür hinterlegt ist. */
  calculator: AboCalculation | null;
  year: number;
  visitDays: number;
  starts: number;
  streakWeeks: number;
  progress: MilestoneProgress[];
  level: { current: MilestoneProgress | null; next: MilestoneProgress | null };
  vouchers: RiderVoucher[];
}

/**
 * Alles, was die Kunden-App zeigt. Liefert null, wenn der Token unbekannt ist
 * oder am Profil kein Ticket mehr hängt.
 */
export async function loadRider(token: string, now: Date = new Date(), adopted = false): Promise<RiderView | null> {
  if (!token || token.length < 16) return null;
  const profile = await prisma.riderProfile.findUnique({
    where: { token },
    include: {
      account: { select: { name: true, isActive: true } },
      tickets: {
        select: {
          id: true,
          name: true,
          firstName: true,
          status: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          serviceId: true,
          email: true,
          subscription: { select: { name: true, areas: { select: { name: true }, orderBy: { name: "asc" } } } },
        },
      },
    },
  });
  // Ohne Ticket nur mit bestätigter Adresse (Kunde noch ohne Abo).
  if (!profile || !profile.account.isActive || (profile.tickets.length === 0 && !profile.email)) return null;

  // Neue Tagestickets mit derselben E-Mail-Adresse gehören zum selben Gast.
  if (!adopted) {
    const emails = [...new Set([profile.email, ...profile.tickets.map((t) => t.email?.trim().toLowerCase())].filter((e): e is string => !!e))].slice(0, 5);
    let added = 0;
    for (const e of emails) added += await adoptDayTickets(profile.accountId, e, now).catch(() => 0);
    if (added > 0) return loadRider(token, now, true);
  }

  // Nutzung merken (für „App aktiv“ in der Verwaltung), höchstens einmal je Stunde.
  if (!profile.lastSeenAt || now.getTime() - profile.lastSeenAt.getTime() > 3_600_000) {
    void prisma.riderProfile
      .update({ where: { id: profile.id }, data: { lastSeenAt: now } })
      .catch(() => {});
  }

  const accountId = profile.accountId;
  const ticketIds = profile.tickets.map((t) => t.id);
  const ymd = berlinYmd(now);
  const year = Number(ymd.slice(0, 4));

  const [config, stats, milestones, vouchers] = await Promise.all([
    prisma.gamificationConfig.findUnique({ where: { accountId } }),
    prisma.riderDayStat.findMany({
      where: {
        accountId,
        ticketId: { in: ticketIds },
        day: { gte: ymdToDbDate(`${year}-01-01`), lte: ymdToDbDate(`${year}-12-31`) },
      },
      select: { day: true, starts: true },
    }),
    prisma.milestone.findMany({
      where: { accountId, active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.voucher.findMany({
      where: { accountId, kind: "BENEFIT", ownerTicketId: { in: ticketIds } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const cap = config?.startCapPerDay ?? 10;
  const days = mergeDayStats(stats.map((s) => ({ day: dbDateToYmd(s.day), starts: s.starts })));
  const metrics = computeMetrics(days, 0);
  const progress = milestoneProgress(
    milestones.map((m) => ({
      id: m.id,
      name: m.name,
      metric: m.metric as GamiMetric,
      period: m.period as GamiPeriod,
      threshold: m.threshold,
      voucherLabel: m.voucherLabel,
    })),
    days,
    ymd,
    cap,
  );

  // Das Abo, das am längsten gilt, ist das aktuelle.
  const withSub = profile.tickets.filter((t) => t.subscription);
  const newest = [...withSub].sort(
    (a, b) => (b.endDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (a.endDate?.getTime() ?? Number.MAX_SAFE_INTEGER),
  )[0];
  const usable = newest && (newest.status === "VALID" || newest.status === "REDEEMED");

  // Abo-Rechner: nur für Gäste ohne Abo, aus den Tagestickets dieser Saison.
  const dayGuest = withSub.length === 0;
  let calculator: AboCalculation | null = null;
  if (dayGuest && config) {
    const servicePrices = parsePriceMap(config.servicePrices);
    const aboPrices = parsePriceMap(config.subscriptionPrices);
    const seasonTickets = profile.tickets.filter(
      (t) => t.serviceId != null && config.dayServiceIds.includes(t.serviceId) && berlinYmd(t.startDate ?? t.createdAt).startsWith(String(year)),
    );
    const abos = aboPrices.size
      ? await prisma.subscription.findMany({
          where: { accountId, id: { in: [...aboPrices.keys()].filter((id) => config.subscriptionIds.includes(id)) } },
          select: { id: true, name: true },
        })
      : [];
    // Eine Buchung gilt oft für mehrere Personen: je Tag zählt nur das teuerste Ticket.
    const perDay = new Map<string, number | null>();
    for (const t of seasonTickets) {
      const day = berlinYmd(t.startDate ?? t.createdAt);
      const price = servicePrices.get(t.serviceId!) ?? null;
      const known = perDay.get(day);
      perDay.set(day, !perDay.has(day) ? price : known == null || price == null ? null : Math.max(known, price));
    }
    calculator = aboCalculation(
      metrics.visitDays,
      [...perDay.values()],
      abos.map((a) => ({ name: a.name, cents: aboPrices.get(a.id)! })),
    );
  }

  const first = newest ?? profile.tickets[0];
  const order: Record<BenefitVoucherState, number> = { open: 0, redeemed: 1, expired: 2, disabled: 3 };
  return {
    profileId: profile.id,
    accountId,
    accountName: profile.account.name,
    ticketIds,
    // Tagestickets tragen keinen Namen: dann grüßt die App mit dem Spitznamen oder ohne Namen.
    firstName: first?.firstName?.trim() || (dayGuest ? profile.nickname ?? "" : first?.name ?? ""),
    nickname: profile.nickname,
    showInRanking: profile.showInRanking,
    enabled: config?.enabled ?? false,
    abo: newest?.subscription
      ? {
          name: newest.subscription.name,
          endDate: newest.endDate,
          active: !!usable && (!newest.endDate || newest.endDate.getTime() >= now.getTime()),
          areas: newest.subscription.areas.map((a) => a.name),
        }
      : null,
    dayGuest,
    calculator,
    startCapPerDay: cap,
    year,
    visitDays: metrics.visitDays,
    starts: metrics.starts,
    streakWeeks: currentWeekStreak(days.map((d) => d.day), ymd),
    progress,
    level: seasonLevel(progress),
    vouchers: vouchers
      .map((v) => ({
        id: v.id,
        code: v.code,
        label: v.label ?? "Gutschein",
        source: v.notes,
        state: benefitVoucherState(v, now),
        expiresAt: v.expiresAt,
        redeemedAt: v.redeemedAt,
      }))
      .filter((v) => v.state !== "disabled")
      .sort((a, b) => order[a.state] - order[b.state]),
  };
}

/** Je Request nur einmal laden (Layout und Seite teilen sich das Ergebnis). */
export const loadRiderCached = cache((token: string) => loadRider(token));

/**
 * Profil zu einem Abo-Ticket holen oder anlegen. Weitere Abo-Tickets
 * derselben Person (Vorname, Nachname, Geburtsdatum gleich) kommen mit ins
 * Profil. Hebt einen früheren Ausstieg auf: wer sich anmeldet, macht mit.
 */
export async function ensureRiderProfile(accountId: number, ticketId: number): Promise<{ token: string } | null> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId, subscriptionId: { not: null } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      riderProfile: { select: { id: true, token: true } },
    },
  });
  if (!ticket) return null;

  const samePerson =
    ticket.firstName && ticket.lastName && ticket.birthDate
      ? { firstName: ticket.firstName, lastName: ticket.lastName, birthDate: ticket.birthDate }
      : null;

  let profile = ticket.riderProfile;
  if (!profile && samePerson) {
    // Hat ein anderes Ticket derselben Person schon ein Profil, dann dieses nutzen.
    const sibling = await prisma.ticket.findFirst({
      where: { accountId, subscriptionId: { not: null }, riderProfileId: { not: null }, ...samePerson },
      select: { riderProfile: { select: { id: true, token: true } } },
    });
    profile = sibling?.riderProfile ?? null;
  }
  if (!profile) {
    profile = await prisma.riderProfile.create({
      data: { token: newRiderToken(), accountId },
      select: { id: true, token: true },
    });
  }

  await prisma.ticket.updateMany({
    where: {
      accountId,
      subscriptionId: { not: null },
      OR: [{ id: ticket.id }, ...(samePerson ? [{ riderProfileId: null, ...samePerson }] : [])],
    },
    data: { riderProfileId: profile.id, gamificationOptOut: false },
  });
  return { token: profile.token };
}

/**
 * Aussteigen: Tagessummen und Meilensteine der Person löschen, künftig nichts
 * mehr zählen, Profil entfernen. Bereits verdiente Gutscheine bleiben gültig
 * und sind an der Kasse über den Namen auffindbar.
 */
export async function deleteRiderData(profileId: number, accountId: number): Promise<void> {
  const tickets = await prisma.ticket.findMany({
    where: { accountId, riderProfileId: profileId },
    select: { id: true },
  });
  const ticketIds = tickets.map((t) => t.id);
  await prisma.$transaction([
    prisma.riderDayStat.deleteMany({ where: { accountId, ticketId: { in: ticketIds } } }),
    // Awards mit Gutschein bleiben: sonst gäbe es nach erneuter Anmeldung denselben Gutschein noch einmal.
    prisma.milestoneAward.deleteMany({ where: { accountId, ticketId: { in: ticketIds }, voucherId: null } }),
    prisma.challengeAward.deleteMany({ where: { accountId, ticketId: { in: ticketIds }, voucherId: null } }),
    prisma.ticket.updateMany({
      where: { accountId, id: { in: ticketIds } },
      data: { gamificationOptOut: true, riderProfileId: null },
    }),
    prisma.riderProfile.delete({ where: { id: profileId } }),
  ]);
}

export interface RiderRecap {
  year: number;
  recap: SeasonRecap;
  /** Anteil der anderen Abo-Fahrer, die seltener da waren; null bei zu wenig Vergleich. */
  aheadOf: number | null;
}

/**
 * Saisonrückblick eines Fahrers für das laufende oder das vergangene Jahr.
 * Verglichen wird je Ticket mit den Besuchstagen aller anderen Abo-Fahrer.
 */
export async function loadRiderRecap(rider: RiderView, year: number): Promise<RiderRecap | null> {
  if (year !== rider.year && year !== rider.year - 1) return null;
  const range = { gte: ymdToDbDate(`${year}-01-01`), lte: ymdToDbDate(`${year}-12-31`) };
  const [own, others] = await Promise.all([
    prisma.riderDayStat.findMany({
      where: { accountId: rider.accountId, ticketId: { in: rider.ticketIds }, day: range },
      select: { day: true, starts: true },
    }),
    prisma.riderDayStat.groupBy({
      by: ["ticketId"],
      where: { accountId: rider.accountId, ticketId: { notIn: rider.ticketIds }, day: range },
      _count: { _all: true },
    }),
  ]);
  const recap = seasonRecap(mergeDayStats(own.map((s) => ({ day: dbDateToYmd(s.day), starts: s.starts }))));
  return {
    year,
    recap,
    aheadOf: recap.visitDays > 0 ? aheadOfPercent(recap.visitDays, others.map((o) => o._count._all)) : null,
  };
}
