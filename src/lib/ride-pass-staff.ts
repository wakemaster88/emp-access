/**
 * Ride Pass einer Person für das Personal (Abos › Kundenkonten › Person):
 * dieselben Zahlen wie in der Kunden-App, nur gelesen. Anders als in der App
 * wird nichts vergeben, ausgewertet oder als „zuletzt gesehen“ gemerkt.
 *
 * Alles kommt als fertiger Text bzw. ISO-Datum zurück, damit die
 * Client-Komponente kein Modul mit Datenbankzugriff laden muss.
 */
import { prisma } from "./prisma";
import { loadRider, loadRiderRecap, type RiderRecap } from "./rider-app";
import { loadRiderChallenges } from "./rider-challenges";
import { awardRemainingText, awardCountable, CATEGORY_LABEL, tierRank } from "./awards";
import { formatDegrees, METRIC_LABEL, TIER_LABEL, tempStatNote, type GamiTier, type TempStat } from "./gamification";
import type { RidePassStaffView, RidePassTemp } from "./ride-pass-staff-types";

export type { RidePassStaffView } from "./ride-pass-staff-types";

/** So viele Awards in Arbeit zeigt die Ansicht höchstens. */
const NEXT_SHOWN = 3;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function temp(stat: TempStat | null, visitDays: number): RidePassTemp | null {
  if (!stat) return null;
  // Die App spricht den Fahrer an; hier geht es um die Person.
  const note = tempStatNote(stat, visitDays).replace("an deinem Tag am Lift", "an einem Tag am Lift");
  return { avg: `${formatDegrees(stat.avg)} °C`, note };
}

function recapView(r: RiderRecap | null): RidePassStaffView["recaps"][number] | null {
  if (!r || r.recap.visitDays === 0) return null;
  return {
    year: r.year,
    visitDays: r.recap.visitDays,
    starts: r.recap.starts,
    streakWeeks: r.recap.streakWeeks,
    bestMonth: r.recap.bestMonth?.name ?? null,
    bestWeekday: r.recap.bestWeekday?.name ?? null,
    bestDay: r.recap.bestDay,
    firstDay: r.recap.firstDay,
    lastDay: r.recap.lastDay,
    aheadOf: r.aheadOf,
    air: temp(r.air, r.recap.visitDays),
    water: temp(r.water, r.recap.visitDays),
    waterSensor: r.waterSensor,
  };
}

/**
 * Ride Pass der Person `personId` (RiderProfile) im Konto `accountId`.
 * Null, wenn es die Person im Konto nicht gibt.
 */
export async function loadRidePassForStaff(
  accountId: number,
  personId: number,
  now: Date = new Date(),
): Promise<RidePassStaffView | null> {
  const person = await prisma.riderProfile.findFirst({
    where: { id: personId, accountId },
    select: { token: true, lastSeenAt: true, nickname: true, showInRanking: true, _count: { select: { tickets: true } } },
  });
  if (!person) return null;

  const base = {
    lastSeenAt: iso(person.lastSeenAt),
    nickname: person.nickname,
    showInRanking: person.showInRanking,
  };
  const rider = await loadRider(person.token, now, true, true, true);
  if (!rider) {
    return { ...base, enabled: true, empty: true, year: now.getFullYear(), stats: null, recaps: [], awards: { unlocked: [], total: 0, next: [], earlier: [] }, challenges: [], vouchers: [] };
  }

  const [current, previous, challenges] = await Promise.all([
    loadRiderRecap(rider, rider.year).catch(() => null),
    loadRiderRecap(rider, rider.year - 1).catch(() => null),
    loadRiderChallenges(rider, now, true).catch(() => []),
  ]);

  const unlocked = rider.awards
    .filter((a) => a.unlocked)
    .sort((a, b) => (b.awardedAt?.getTime() ?? 0) - (a.awardedAt?.getTime() ?? 0))
    .map((a) => ({
      id: a.id,
      name: a.name,
      tier: TIER_LABEL[a.tier as GamiTier],
      tierRank: tierRank(a.tier as GamiTier),
      category: CATEGORY_LABEL[a.category],
      text: a.text,
      awardedAt: iso(a.awardedAt),
    }));
  // Frühere Saisons: Awards, die im laufenden Zeitraum noch fehlen, aber schon einmal vergeben wurden.
  const earlier = rider.awards
    .filter((a) => !a.unlocked && a.lastPeriod)
    .map((a) => ({ id: a.id, name: a.name, period: a.lastPeriod! }));
  const next = rider.awards
    .filter((a) => !a.unlocked && awardCountable(a) && a.value > 0)
    .sort((a, b) => b.value / b.threshold - a.value / a.threshold)
    .slice(0, NEXT_SHOWN)
    .map((a) => ({
      id: a.id,
      name: a.name,
      value: a.value,
      threshold: a.threshold,
      remaining: awardRemainingText(a),
    }));

  return {
    ...base,
    enabled: rider.enabled,
    empty: false,
    year: rider.year,
    stats: {
      visitDays: rider.visitDays,
      starts: rider.starts,
      startsTotal: rider.startsTotal,
      streakWeeks: rider.streakWeeks,
      seasons: rider.seasons,
      seasonsSince: rider.seasonsSince,
      level: rider.level.current?.name ?? null,
    },
    recaps: [recapView(current), recapView(previous)].filter((r): r is NonNullable<typeof r> => r != null),
    awards: { unlocked, total: rider.awards.length, next, earlier },
    challenges: challenges
      .filter((c) => c.phase !== "upcoming")
      .map((c) => {
        const metric = METRIC_LABEL[c.metric];
        let standing: string;
        if (c.kind === "TASK") {
          const goal = c.threshold ?? 0;
          standing = `${Math.min(c.value, goal)} von ${goal} ${metric}`;
        } else if (c.kind === "PHOTO") {
          const own = c.voting?.entries.find((e) => e.mine);
          standing = own
            ? `${own.hidden ? "Foto ausgeblendet" : "Foto eingereicht"}${own.rank != null ? ` · Platz ${own.rank}` : ""}`
            : "kein Foto eingereicht";
          if (c.voting?.myVoted) standing += " · hat abgestimmt";
        } else if (c.kind === "POLL") {
          const choice = c.voting?.options.find((o) => o.voted);
          standing = choice ? `gestimmt für „${choice.label}“` : "noch nicht abgestimmt";
        } else {
          standing = c.rank != null
            ? `Platz ${c.rank} von ${c.participants} · ${c.value} ${metric}`
            : `${c.phase === "running" ? "noch kein Start" : "ohne Start im Zeitraum"} · ${c.participants} Fahrer dabei`;
        }
        return {
          id: c.id,
          name: c.name,
          running: c.phase === "running",
          won: c.won,
          kind: c.kind === "TASK" ? "Aufgabe" : c.kind === "PHOTO" ? "Foto" : c.kind === "POLL" ? "Abstimmung" : `Top ${c.topCount ?? ""}`.trim(),
          standing,
          endDate: iso(c.endDate)!,
          voucherLabel: c.voucherLabel,
        };
      }),
    vouchers: rider.vouchers.map((v) => ({
      id: v.id,
      code: v.code,
      label: v.label,
      award: v.award?.name ?? null,
      state: v.state === "disabled" ? "expired" : v.state,
      expiresAt: iso(v.expiresAt),
      redeemedAt: iso(v.redeemedAt),
    })),
  };
}
