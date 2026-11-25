/**
 * Kunden-App: Challenges und Angebote aus Sicht eines Fahrers.
 *
 * In Ranglisten steht nur der Spitzname von Fahrern, die dem zugestimmt
 * haben (`RiderProfile.showInRanking`). Alle anderen erscheinen als „Anonym“.
 */
import { audiencesFor, type PassKind } from "./rider-pass";
import { cache } from "react";
import { skillRewardText } from "./rider-skill-rules";
import { prisma, tenantClient, type TenantDb } from "./prisma";
import { berlinHm, berlinYmd } from "./berlin-day";
import {
  challengeConditionText,
  challengePhase,
  dbDateToYmd,
  offerVisible,
  ymdToDbDate,
  type ChallengeKind,
  type ChallengePhase,
  type GamiMetric,
} from "./gamification";
import {
  awardTaskChallenges, challengeUnits, openChallenges, rankUnits, settleDueChallenges, type ChallengeRow, type RiderUnit,
} from "./challenge-service";
import { createTtlCache } from "./ttl-cache";
import type { RiderView } from "./rider-app";
import { loadVoting, type VotingView } from "./challenge-voting";
import { CHALLENGE_KEEP_ENDED_DAYS } from "./challenge-voting-rules";
import { loadFamilyMembers } from "./rider-family";

export interface RiderChallenge {
  id: number;
  name: string;
  description: string | null;
  kind: ChallengeKind;
  metric: GamiMetric;
  condition: string;
  phase: ChallengePhase;
  startDate: Date;
  endDate: Date;
  /** Uhrzeit am Endtag ("HH:MM"), sonst null. */
  endTime: string | null;
  voucherLabel: string | null;
  /** Skill als Gewinn, z. B. „Außendusche · 10×“. */
  skillLabel: string | null;
  /** Eigener Wert im Zeitraum. */
  value: number;
  threshold: number | null;
  topCount: number | null;
  /** Aufgabe erfüllt bzw. Top-X gewonnen. */
  won: boolean;
  /** Top X: eigener Platz (null ohne Start im Zeitraum) und Zahl der Teilnehmer. */
  rank: number | null;
  participants: number;
  top: Array<{ rank: number; name: string; value: number; me: boolean }>;
  /** Foto-Challenge und Abstimmung: Fotos bzw. Antworten mit dem Stand der Person. */
  voting: VotingView | null;
}

const KEEP_ENDED_DAYS = CHALLENGE_KEEP_ENDED_DAYS;

/**
 * Kurz im Speicher je Instanz: Ranglisten (`challengeUnits`) sind für alle
 * Kunden gleich, Auswertung und Vergabe müssen nicht bei jedem Aufruf laufen.
 * Der eigene Wert kommt aus der Rangliste; der Gewinn (`won`) wird immer frisch gelesen.
 */
const CHALLENGE_TTL_MS = 60_000;
const unitsCache = createTtlCache<RiderUnit[]>(CHALLENGE_TTL_MS, { maxEntries: 200 });
const settleThrottle = createTtlCache<number>(CHALLENGE_TTL_MS, { maxEntries: 50 });
const taskThrottle = createTtlCache<number>(CHALLENGE_TTL_MS);

/** Rangliste einer Challenge; der Schlüssel enthält alles, wonach sie zählt. */
function cachedUnits(db: TenantDb, accountId: number, c: ChallengeRow, cap: number): Promise<RiderUnit[]> {
  const key = [accountId, c.id, cap, c.kind, c.metric, c.audience, c.startDate.getTime(), c.endDate.getTime()].join(":");
  return unitsCache.get(key, () => challengeUnits(db, accountId, c, cap));
}

function shiftYmd(ymd: string, days: number): string {
  return new Date(ymdToDbDate(ymd).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Laufende, kommende und kürzlich beendete Challenges mit dem Stand des Fahrers. */
export async function loadRiderChallenges(
  rider: RiderView,
  now: Date = new Date(),
  /** Ansicht für das Personal: nichts auswerten oder vergeben, nur lesen. */
  readOnly = false,
): Promise<RiderChallenge[]> {
  if (!rider.enabled) return [];
  const { accountId } = rider;
  const db = tenantClient(accountId);
  const today = berlinYmd(now);
  // Fällige Top-X-Challenges auswerten, damit das Ergebnis sofort sichtbar ist
  // (je Mandant höchstens einmal je Minute).
  if (!readOnly) {
    await settleThrottle.get(`${accountId}:${rider.startCapPerDay}`, () =>
      settleDueChallenges(db, accountId, today, rider.startCapPerDay).catch(() => 0),
    );
  }
  // Aufgaben, die schon vor dem Anlegen der Challenge erfüllt waren, jetzt vergeben
  // (je Person höchstens einmal je Minute).
  if (!readOnly && rider.ticketIds.length > 0) {
    await taskThrottle.get(`${accountId}:${rider.profileId}`, () =>
      openChallenges(db, accountId)
        .then((open) =>
          awardTaskChallenges(db, accountId, Math.max(...rider.ticketIds), today, rider.startCapPerDay, open),
        )
        .catch(() => 0),
    );
  }

  const challenges = await prisma.challenge.findMany({
    where: {
      accountId,
      active: true,
      audience: { in: audiencesFor(rider.pass) },
      endDate: { gte: ymdToDbDate(shiftYmd(today, -KEEP_ENDED_DAYS)) },
    },
    orderBy: [{ endDate: "asc" }, { id: "asc" }],
    take: 30,
    include: { skill: { select: { name: true, active: true } } },
  });
  if (challenges.length === 0) return [];

  const awards = await prisma.challengeAward.findMany({
    where: { accountId, challengeId: { in: challenges.map((c) => c.id) }, ticketId: { in: rider.ticketIds } },
    select: { challengeId: true },
  });
  const wonIds = new Set(awards.map((a) => a.challengeId));
  const myKey = `p${rider.profileId}`;
  // Die eigene Familie steht mit Namen da, auch ohne Spitznamen (Aaron, 21.11.2026).
  const familyNames = await familyNamesOf(accountId, rider.profileId);

  const phases = new Map(
    challenges.map((c) => [c.id, challengePhase({ startYmd: dbDateToYmd(c.startDate), endYmd: dbDateToYmd(c.endDate), endTime: c.endTime }, today, berlinHm(now))]),
  );
  const voting = await loadVoting(
    accountId,
    challenges.map((c) => ({ id: c.id, kind: c.kind, phase: phases.get(c.id)!, topCount: c.topCount })),
    rider.profileId,
    false,
    familyNames,
  ).catch((e) => {
    console.error("[challenges] Abstimmungen nicht geladen:", e instanceof Error ? e.message : e);
    return new Map<number, VotingView>();
  });

  // Ranglisten nebeneinander laden statt nacheinander.
  const unitsOf = await Promise.all(
    challenges.map((c) => (phases.get(c.id) === "upcoming" ? [] : cachedUnits(db, accountId, c as ChallengeRow, rider.startCapPerDay))),
  );
  const out: RiderChallenge[] = [];
  for (const [i, c] of challenges.entries()) {
    const phase = phases.get(c.id)!;
    const units = unitsOf[i];
    const mine = units.find((u) => u.key === myKey);
    let rank: number | null = null;
    let top: RiderChallenge["top"] = [];
    if (c.kind === "TOP_X") {
      const ranked = rankUnits(units, c.topCount ?? 0);
      rank = ranked.find((s) => s.key === myKey)?.rank ?? null;
      const shown = ranked.slice(0, Math.max(c.topCount ?? 0, 5));
      const profileIds = shown.map((s) => s.unit.profileId).filter((id): id is number => id != null);
      const profiles = profileIds.length
        ? await prisma.riderProfile.findMany({
            where: { accountId, id: { in: profileIds }, showInRanking: true, nickname: { not: null } },
            select: { id: true, nickname: true },
          })
        : [];
      const nick = new Map(profiles.map((p) => [p.id, p.nickname]));
      top = shown.map((s) => ({
        rank: s.rank,
        value: s.value,
        me: s.key === myKey,
        name:
          s.key === myKey
            ? "Du"
            : (s.unit.profileId != null && (familyNames.get(s.unit.profileId) ?? nick.get(s.unit.profileId))) || "Anonym",
      }));
    }
    out.push({
      id: c.id,
      name: c.name,
      description: c.description,
      kind: c.kind,
      metric: c.metric as GamiMetric,
      condition: challengeConditionText({ ...c, metric: c.metric as GamiMetric }),
      phase,
      startDate: c.startDate,
      endDate: c.endDate,
      endTime: c.endTime,
      voucherLabel: c.voucherLabel,
      skillLabel: c.skill?.active ? skillRewardText(c.skill.name, c.skillUses) : null,
      value: mine?.value ?? 0,
      threshold: c.threshold,
      topCount: c.topCount,
      won: wonIds.has(c.id),
      rank,
      participants: units.filter((u) => u.value > 0).length,
      top,
      voting: voting.get(c.id) ?? null,
    });
  }
  const order: Record<ChallengePhase, number> = { running: 0, upcoming: 1, ended: 2 };
  return out.sort((a, b) => order[a.phase] - order[b.phase]);
}

/** Namen der anderen Mitglieder der Familie dieser Person (Profil-ID → Name). */
async function familyNamesOf(accountId: number, profileId: number): Promise<Map<number, string>> {
  const p = await prisma.riderProfile.findFirst({ where: { id: profileId, accountId }, select: { familyId: true } });
  if (p?.familyId == null) return new Map();
  const members = await loadFamilyMembers(p.familyId, accountId);
  return new Map(members.filter((m) => m.profileId !== profileId).map((m) => [m.profileId, m.name]));
}

export const loadRiderChallengesCached = cache((rider: RiderView) => loadRiderChallenges(rider));

export interface RiderOfferView {
  id: number;
  title: string;
  text: string | null;
  validFrom: Date | null;
  validTo: Date | null;
}

/**
 * Angebote oder News, die heute sichtbar sind. Angebote in der Reihenfolge
 * der Verwaltung, News die neueste zuerst.
 */
export async function loadRiderOffers(
  accountId: number,
  pass: PassKind = "RIDE",
  now: Date = new Date(),
  kind: "OFFER" | "NEWS" = "OFFER",
): Promise<RiderOfferView[]> {
  const today = berlinYmd(now);
  const offers = await prisma.riderOffer.findMany({
    where: { accountId, kind, active: true, audience: { in: audiencesFor(pass) } },
    orderBy: kind === "NEWS" ? [{ validFrom: { sort: "desc", nulls: "last" } }, { id: "desc" }] : [{ sortOrder: "asc" }, { id: "asc" }],
    take: 20,
  });
  return offers
    .filter((o) =>
      offerVisible(
        { active: o.active, fromYmd: o.validFrom ? dbDateToYmd(o.validFrom) : null, toYmd: o.validTo ? dbDateToYmd(o.validTo) : null },
        today,
      ),
    )
    .map((o) => ({ id: o.id, title: o.title, text: o.text, validFrom: o.validFrom, validTo: o.validTo }));
}
