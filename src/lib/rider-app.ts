/**
 * Kunden-App (`/app/<token>`): Profil laden, anlegen und löschen.
 *
 * Ein Profil bündelt alle Abo-Tickets einer Person, weil eine Verlängerung
 * teils ein neues Ticket anlegt. Der Token im Link ist die Berechtigung.
 */
import { randomBytes } from "node:crypto";
import { cache } from "react";
import { prisma, tenantClient } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { adoptDayTickets } from "./day-guest";
import { samePersonAbos } from "./abo-person";
import { aboNamesRider, isKidsSubscriptionName } from "./customer-person";
import { awardCategory, awardText, voucherShortLabel, type AwardCategory } from "./awards";
import { awardMilestones, loadPersonDays, toMilestoneRule } from "./gamification-service";
import {
  benefitVoucherState,
  computeMetrics,
  currentWeekStreak,
  dbDateToYmd,
  aboCalculation,
  aheadOfPercent,
  parsePriceMap,
  mergeDayStats,
  periodKey,
  seasonRecap,
  seasonsCount,
  milestoneProgress,
  seasonLevel,
  ymdToDbDate,
  type AboCalculation,
  type BenefitVoucherState,
  type GamiMetric,
  type GamiPeriod,
  type GamiTier,
  type MilestoneProgress,
  type SeasonRecap,
} from "./gamification";
import { paymentOpenInfo, paymentOpenSentence } from "@/lib/payment-open";

export function newRiderToken(): string {
  return randomBytes(18).toString("base64url");
}

export function riderAppPath(token: string): string {
  return `/app/${encodeURIComponent(token)}`;
}

/** Was das Abzeichen eines Awards braucht (Form und Aufdruck folgen aus Zählart, Ziel und Schlüssel). */
export interface AwardBadgeData {
  name: string;
  tier: GamiTier;
  metric: GamiMetric;
  threshold: number;
  key: string | null;
}

export interface RiderVoucher {
  id: number;
  code: string;
  label: string;
  source: string | null;
  state: BenefitVoucherState;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  /** Award, aus dem der Gutschein stammt (für Abzeichen und Kurztext). */
  award: (AwardBadgeData & { id: number; voucherShort: string | null }) | null;
}

/** Ein Award im Trophy Case der Kunden-App, mit dem Stand der Person. */
export interface RiderAward extends AwardBadgeData {
  /** ID des Meilensteins. */
  id: number;
  period: GamiPeriod;
  category: AwardCategory;
  /** Stand, höchstens das Ziel. */
  value: number;
  /** Im laufenden Zeitraum (oder überhaupt) vergeben. */
  unlocked: boolean;
  awardedAt: Date | null;
  /** Früherer Zeitraum mit diesem Award ("2026"), wenn er im laufenden noch fehlt. */
  lastPeriod: string | null;
  /** Wofür es den Award gibt. */
  text: string;
  voucherLabel: string | null;
  voucherShort: string | null;
  bonus: string | null;
  /** Gutschein aus diesem Award im laufenden Zeitraum. */
  voucher: { id: number; state: BenefitVoucherState; expiresAt: Date | null; redeemedAt: Date | null } | null;
}

/** Frisch vergebener Award, dessen Freischalt-Moment die App noch zeigen soll. */
export interface RiderUnlock extends AwardBadgeData {
  /** ID der Vergabe (`MilestoneAward`). */
  awardId: number;
  milestoneId: number;
  text: string;
  voucherLabel: string | null;
  bonus: string | null;
  /** Offener Gutschein dazu, falls es einen gibt. */
  voucherId: number | null;
}

/** So viele Freischalt-Momente zeigt die App höchstens nacheinander. */
export const MAX_UNLOCKS_SHOWN = 6;

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
  abo: {
    name: string;
    endDate: Date | null;
    active: boolean;
    areas: string[];
    /** „24 € offen, fällig seit …“, wenn der Abgleich das Abo wegen offener Rechnung pausiert hat. */
    paymentOpen: string | null;
  } | null;
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
  /** Alle aktiven Awards in der Reihenfolge der Verwaltung. */
  awards: RiderAward[];
  /** Noch nicht gezeigte Freischalt-Momente, älteste zuerst. */
  unlocks: RiderUnlock[];
  /** Starts über alle Jahre (mit Tagesgrenze). */
  startsTotal: number;
  /** Saisons dabei und das Jahr der ersten. */
  seasons: number;
  seasonsSince: number | null;
}

/**
 * Alles, was die Kunden-App zeigt. Liefert null, wenn der Token unbekannt ist
 * oder am Profil kein Ticket mehr hängt.
 */
export async function loadRider(
  token: string,
  now: Date = new Date(),
  adopted = false,
  awarded = false,
): Promise<RiderView | null> {
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
          extras: true,
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
    if (added > 0) return loadRider(token, now, true, awarded);
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

  const [config, milestones, vouchers, awardRows] = await Promise.all([
    prisma.gamificationConfig.findUnique({ where: { accountId } }),
    prisma.milestone.findMany({
      where: { accountId, active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.voucher.findMany({
      where: { accountId, kind: "BENEFIT", ownerTicketId: { in: ticketIds } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.milestoneAward.findMany({
      where: { accountId, ticketId: { in: ticketIds } },
      select: { id: true, milestoneId: true, periodKey: true, awardedAt: true, seenAt: true, voucherId: true },
      orderBy: { awardedAt: "desc" },
      take: 500,
    }),
  ]);
  // Awards ohne Zeitraum zählen über alle Jahre; die Saisonwerte unten nur das laufende.
  const allDays = await loadPersonDays(prisma, accountId, ticketIds, milestones.some((m) => m.metric === "EARLY_DAYS"));

  const cap = config?.startCapPerDay ?? 10;
  const days = allDays.filter((d) => d.day.startsWith(String(year)));
  const metrics = computeMetrics(days, 0);
  const seasons = seasonsCount(allDays, profile.ridingSince, ymd);
  const progress = milestoneProgress(
    milestones.map((m) => ({ ...toMilestoneRule(m), name: m.name, voucherLabel: m.voucherLabel })),
    allDays,
    ymd,
    cap,
    seasons,
  );

  // Schon erreicht, aber noch nicht vergeben (z. B. Ziel vor dem Start der
  // Awards geschafft): jetzt vergeben, damit Abzeichen und Gutschein zusammen
  // erscheinen. Sonst käme beides erst mit dem nächsten Start am Lift.
  const currentKey = (m: { id: number; period: string }) => `${m.id}:${periodKey(m.period as GamiPeriod, ymd)}`;
  const awardedNow = new Map(awardRows.map((a) => [`${a.milestoneId}:${a.periodKey}`, a]));
  const awardTicket = profile.tickets.filter((t) => t.subscription).sort((a, b) => b.id - a.id)[0] ?? profile.tickets[0];
  if (!awarded && config?.enabled && awardTicket) {
    const pending = milestones.some((m) => progress.find((p) => p.id === m.id)?.reached && !awardedNow.has(currentKey(m)));
    if (pending) {
      const created = await awardMilestones(tenantClient(accountId), accountId, awardTicket.id, ymd, cap, { notify: false }).catch(
        (e) => {
          console.error("[rider-app] Awards beim Öffnen vergeben fehlgeschlagen:", e);
          return 0;
        },
      );
      if (created > 0) return loadRider(token, now, true, true);
    }
  }

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

  const voucherById = new Map(vouchers.map((v) => [v.id, v]));
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));
  const badge = (m: (typeof milestones)[number]): AwardBadgeData => ({
    name: m.name,
    tier: m.tier as GamiTier,
    metric: m.metric as GamiMetric,
    threshold: m.threshold,
    key: m.key,
  });
  const awards: RiderAward[] = milestones.map((m) => {
    const p = progress.find((x) => x.id === m.id);
    const row = awardedNow.get(currentKey(m)) ?? null;
    // Die Liste ist nach Datum absteigend sortiert: der erste andere Zeitraum ist der jüngste.
    const earlier = row ? null : awardRows.find((a) => a.milestoneId === m.id) ?? null;
    const v = row?.voucherId != null ? voucherById.get(row.voucherId) ?? null : null;
    return {
      ...badge(m),
      id: m.id,
      period: m.period as GamiPeriod,
      category: awardCategory(m.metric as GamiMetric),
      value: row ? m.threshold : p?.value ?? 0,
      unlocked: row != null,
      awardedAt: row?.awardedAt ?? null,
      lastPeriod: earlier?.periodKey ?? null,
      text: awardText({ metric: m.metric as GamiMetric, threshold: m.threshold, period: m.period as GamiPeriod, hint: m.hint }),
      voucherLabel: m.voucherLabel,
      voucherShort: voucherShortLabel(m),
      bonus: m.bonus,
      voucher: v && !v.disabledAt
        ? { id: v.id, state: benefitVoucherState(v, now), expiresAt: v.expiresAt, redeemedAt: v.redeemedAt }
        : null,
    };
  });
  const unlocks: RiderUnlock[] = awardRows
    .filter((a) => a.seenAt == null && milestoneById.has(a.milestoneId))
    .slice(0, MAX_UNLOCKS_SHOWN)
    .reverse()
    .map((a) => {
      const m = milestoneById.get(a.milestoneId)!;
      const v = a.voucherId != null ? voucherById.get(a.voucherId) ?? null : null;
      return {
        ...badge(m),
        awardId: a.id,
        milestoneId: m.id,
        text: awardText({ metric: m.metric as GamiMetric, threshold: m.threshold, period: m.period as GamiPeriod, hint: m.hint }),
        voucherLabel: m.voucherLabel,
        bonus: m.bonus,
        voucherId: v && benefitVoucherState(v, now) === "open" ? v.id : null,
      };
    });
  // Gutschein → Award, auch für frühere Zeiträume.
  const awardOfVoucher = new Map<number, (typeof milestones)[number]>();
  for (const a of awardRows) {
    const m = milestoneById.get(a.milestoneId);
    if (a.voucherId != null && m) awardOfVoucher.set(a.voucherId, m);
  }
  const firstYear = allDays.find((d) => d.starts > 0)?.day.slice(0, 4);

  return {
    profileId: profile.id,
    accountId,
    accountName: profile.account.name,
    ticketIds,
    // Vorname der Person (am Kids-Abo steht bei anny der Name der Eltern), sonst vom Abo.
    // Tagestickets tragen keinen Namen: dann grüßt die App mit dem Spitznamen oder ohne Namen.
    firstName: profile.firstName?.trim() || first?.firstName?.trim() || (dayGuest ? profile.nickname ?? "" : first?.name ?? ""),
    nickname: profile.nickname,
    showInRanking: profile.showInRanking,
    enabled: config?.enabled ?? false,
    abo: newest?.subscription
      ? {
          name: newest.subscription.name,
          endDate: newest.endDate,
          active: !!usable && (!newest.endDate || newest.endDate.getTime() >= now.getTime()),
          areas: newest.subscription.areas.map((a) => a.name),
          paymentOpen: (() => {
            const info = newest.status === "PAUSED" ? paymentOpenInfo(newest.extras) : null;
            return info ? paymentOpenSentence(info, now) : null;
          })(),
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
      .map((v) => {
        const m = awardOfVoucher.get(v.id);
        return {
          id: v.id,
          code: v.code,
          label: v.label ?? "Gutschein",
          source: v.notes,
          state: benefitVoucherState(v, now),
          expiresAt: v.expiresAt,
          redeemedAt: v.redeemedAt,
          award: m ? { ...badge(m), id: m.id, voucherShort: voucherShortLabel(m) } : null,
        };
      })
      .filter((v) => v.state !== "disabled")
      .sort((a, b) => order[a.state] - order[b.state]),
    awards,
    unlocks,
    startsTotal: computeMetrics(allDays, cap).starts,
    seasons,
    seasonsSince:
      seasons > 0 && firstYear
        ? Math.min(Number(firstYear), profile.ridingSince != null && profile.ridingSince >= 1950 ? profile.ridingSince : Number(firstYear))
        : null,
  };
}

/** Freischalt-Momente als gezeigt merken: alle offenen der Person, nicht nur die gezeigten. */
export async function markAwardsSeen(rider: Pick<RiderView, "accountId" | "ticketIds">, now: Date = new Date()): Promise<number> {
  if (rider.ticketIds.length === 0) return 0;
  const res = await prisma.milestoneAward.updateMany({
    where: { accountId: rider.accountId, ticketId: { in: rider.ticketIds }, seenAt: null },
    data: { seenAt: now },
  });
  return res.count;
}

/** Je Request nur einmal laden (Layout und Seite teilen sich das Ergebnis). */
export const loadRiderCached = cache((token: string) => loadRider(token));

/**
 * Profil zu einem Abo-Ticket holen oder anlegen. Weitere Abo-Tickets
 * derselben Person (Vorname, Nachname, Geburtsdatum gleich, alle zeitlich
 * nacheinander) kommen mit ins Profil. Laufen Abos mit gleichen Daten
 * gleichzeitig, ist es ein anny-Familienkonto mit mehreren Personen: dann
 * bekommt jedes Abo sein eigenes Profil (siehe lib/abo-person).
 * Hebt einen früheren Ausstieg auf: wer sich anmeldet, macht mit.
 */
export async function ensureRiderProfile(accountId: number, ticketId: number): Promise<{ token: string } | null> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId, subscriptionId: { not: null } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      startDate: true,
      endDate: true,
      customerId: true,
      subscription: { select: { name: true } },
      riderProfile: { select: { id: true, token: true } },
    },
  });
  if (!ticket) return null;

  const samePerson =
    ticket.firstName && ticket.lastName && ticket.birthDate
      ? { firstName: ticket.firstName, lastName: ticket.lastName, birthDate: ticket.birthDate }
      : null;
  const others = samePerson
    ? samePersonAbos([ticket], await prisma.ticket.findMany({
        where: { accountId, subscriptionId: { not: null }, id: { not: ticket.id }, ...samePerson },
        select: { id: true, startDate: true, endDate: true, riderProfileId: true, riderProfile: { select: { id: true, token: true } } },
        take: 50,
      }))
    : [];

  let profile = ticket.riderProfile;
  if (!profile) {
    // Hat ein anderes Ticket derselben Person schon ein Profil, dann dieses nutzen.
    profile = others.find((t) => t.riderProfile != null)?.riderProfile ?? null;
  }
  if (!profile) {
    // Neue Person des Kundenkontos, mit den Daten vom Abo, wenn sie dem
    // Fahrer gehören (nicht beim Kids-Abo mit den Daten der Eltern).
    const ownData = aboNamesRider({ kids: isKidsSubscriptionName(ticket.subscription?.name), birthDate: ticket.birthDate, startDate: ticket.startDate });
    profile = await prisma.riderProfile.create({
      data: {
        token: newRiderToken(),
        accountId,
        customerId: ticket.customerId,
        ...(ownData && { firstName: ticket.firstName, lastName: ticket.lastName, birthDate: ticket.birthDate }),
      },
      select: { id: true, token: true },
    });
  }

  const adopt = others.filter((t) => t.riderProfileId == null).map((t) => t.id);
  await prisma.ticket.updateMany({
    where: {
      accountId,
      subscriptionId: { not: null },
      OR: [{ id: ticket.id }, ...(adopt.length > 0 ? [{ id: { in: adopt }, riderProfileId: null }] : [])],
    },
    data: { riderProfileId: profile.id, gamificationOptOut: false },
  });
  return { token: profile.token };
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
