/**
 * Öffentliche Rangliste für einen Bildschirm (`/rangliste/<token>`).
 *
 * Mit Namen erscheint nur, wer in der Kunden-App einen Spitznamen gesetzt und
 * der Rangliste zugestimmt hat. Alle anderen zählen für die Plätze mit,
 * werden aber nicht gezeigt.
 */
import { prisma, tenantClient } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { METRIC_LABEL, dbDateToYmd, ymdToDbDate, type GamiMetric } from "./gamification";
import { challengeUnits, rankUnits, settleDueChallenges, type ChallengeRow } from "./challenge-service";

export interface RankingBoard {
  title: string;
  subtitle: string;
  unit: string;
  /** Fahrer mit mindestens einem Start im Zeitraum. */
  participants: number;
  rows: Array<{ rank: number; name: string; value: number }>;
}

export interface RankingDisplay {
  accountName: string;
  year: number;
  boards: RankingBoard[];
}

const MAX_ROWS = 8;

function fmt(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}.`;
}

export async function loadRankingDisplay(token: string, now: Date = new Date()): Promise<RankingDisplay | null> {
  if (!token || token.length < 16) return null;
  const config = await prisma.gamificationConfig.findUnique({
    where: { displayToken: token },
    include: { account: { select: { name: true, isActive: true } } },
  });
  if (!config || !config.enabled || !config.account.isActive) return null;

  const accountId = config.accountId;
  const db = tenantClient(accountId);
  const today = berlinYmd(now);
  const year = Number(today.slice(0, 4));
  const cap = config.startCapPerDay;
  await settleDueChallenges(db, accountId, today, cap).catch(() => 0);

  const challenges = await prisma.challenge.findMany({
    where: {
      accountId,
      active: true,
      kind: "TOP_X",
      startDate: { lte: ymdToDbDate(today) },
      endDate: { gte: ymdToDbDate(today) },
    },
    orderBy: [{ endDate: "asc" }, { id: "asc" }],
    take: 2,
  });

  const season: ChallengeRow = {
    id: 0,
    name: `Saison ${year}`,
    kind: "TOP_X",
    metric: "VISIT_DAYS",
    threshold: null,
    topCount: MAX_ROWS,
    startDate: ymdToDbDate(`${year}-01-01`),
    endDate: ymdToDbDate(`${year}-12-31`),
    voucherLabel: null,
    voucherValidDays: null,
  };
  const sources: Array<{ row: ChallengeRow; title: string; subtitle: string }> = [
    { row: season, title: `Saison ${year}`, subtitle: "Meiste Besuchstage" },
    ...challenges.map((c) => ({
      row: c as ChallengeRow,
      title: c.name,
      subtitle: `Top ${c.topCount ?? 0} bis ${fmt(dbDateToYmd(c.endDate))}${c.voucherLabel ? ` · Gewinn: ${c.voucherLabel}` : ""}`,
    })),
  ];

  const ranked = await Promise.all(
    sources.map(async (s) => rankUnits(await challengeUnits(db, accountId, s.row, cap), s.row.topCount ?? 0)),
  );
  const profileIds = [...new Set(ranked.flat().map((r) => r.unit.profileId).filter((id): id is number => id != null))];
  const profiles = profileIds.length
    ? await prisma.riderProfile.findMany({
        where: { accountId, id: { in: profileIds }, showInRanking: true, nickname: { not: null } },
        select: { id: true, nickname: true },
      })
    : [];
  const nick = new Map(profiles.map((p) => [p.id, p.nickname as string]));

  return {
    accountName: config.account.name,
    year,
    boards: sources.map((s, i) => ({
      title: s.title,
      subtitle: s.subtitle,
      unit: METRIC_LABEL[s.row.metric as GamiMetric],
      participants: ranked[i].length,
      rows: ranked[i]
        .filter((r) => r.unit.profileId != null && nick.has(r.unit.profileId))
        .slice(0, MAX_ROWS)
        .map((r) => ({ rank: r.rank, name: nick.get(r.unit.profileId as number) as string, value: r.value })),
    })),
  };
}
