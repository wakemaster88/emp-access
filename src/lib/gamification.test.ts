import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateScans,
  awardKey,
  benefitVoucherState,
  computeMetrics,
  currentWeekStreak,
  longestWeekStreak,
  periodKey,
  reachedMilestones,
  weekIndex,
  type DayStat,
  type MilestoneRule,
} from "./gamification";

test("periodKey: Saison ist das Jahr, Monat ist Jahr-Monat", () => {
  assert.equal(periodKey("SEASON", "2027-06-14"), "2027");
  assert.equal(periodKey("MONTH", "2027-06-14"), "2027-06");
});

test("weekIndex: Montag bis Sonntag gehören zusammen, auch über den Jahreswechsel", () => {
  // 2026-12-28 ist ein Montag, 2027-01-03 der Sonntag derselben Woche.
  assert.equal(weekIndex("2026-12-28"), weekIndex("2027-01-03"));
  assert.equal(weekIndex("2027-01-04"), weekIndex("2026-12-28") + 1);
  // Sonntag und der Montag danach liegen in verschiedenen Wochen.
  assert.notEqual(weekIndex("2027-06-13"), weekIndex("2027-06-14"));
});

test("longestWeekStreak zählt Wochen in Folge, mehrere Tage einer Woche nur einmal", () => {
  assert.equal(longestWeekStreak([]), 0);
  assert.equal(longestWeekStreak(["2027-06-01", "2027-06-03"]), 1);
  // Wochen ab 31.05., 07.06., 14.06. in Folge, dann Lücke, dann 05.07.
  assert.equal(longestWeekStreak(["2027-06-01", "2027-06-12", "2027-06-14", "2027-07-06"]), 3);
});

test("currentWeekStreak: die laufende Woche darf noch leer sein", () => {
  const days = ["2027-06-01", "2027-06-09"];
  assert.equal(currentWeekStreak(days, "2027-06-10"), 2);
  // Montag der Folgewoche, noch kein Besuch: Serie steht weiter bei 2.
  assert.equal(currentWeekStreak(days, "2027-06-14"), 2);
  // Eine ganze Woche ohne Besuch ist vorbei: Serie gerissen.
  assert.equal(currentWeekStreak(days, "2027-06-21"), 0);
});

test("computeMetrics deckelt Starts pro Tag", () => {
  const days: DayStat[] = [
    { day: "2027-06-01", starts: 4 },
    { day: "2027-06-02", starts: 33 },
    { day: "2027-06-03", starts: 0 },
  ];
  assert.deepEqual(computeMetrics(days, 10), { visitDays: 2, starts: 14, streakWeeks: 1 });
  assert.equal(computeMetrics(days, 0).starts, 37);
});

test("reachedMilestones: Schwelle, Zeitraum und bereits Vergebenes", () => {
  const milestones: MilestoneRule[] = [
    { id: 1, metric: "VISIT_DAYS", threshold: 3, period: "SEASON" },
    { id: 2, metric: "VISIT_DAYS", threshold: 3, period: "MONTH" },
    { id: 3, metric: "STARTS", threshold: 100, period: "SEASON" },
    { id: 4, metric: "VISIT_DAYS", threshold: 2, period: "SEASON" },
  ];
  const days: DayStat[] = [
    { day: "2027-05-20", starts: 5 },
    { day: "2027-06-01", starts: 5 },
    { day: "2027-06-08", starts: 5 },
  ];
  const awarded = new Set([awardKey(4, "2027")]);
  assert.deepEqual(reachedMilestones(milestones, days, "2027-06-08", 10, awarded), [
    { milestoneId: 1, periodKey: "2027" },
  ]);
  // Mit einem dritten Juni-Tag ist auch das Monatsziel erreicht.
  const more = [...days, { day: "2027-06-09", starts: 1 }];
  assert.deepEqual(
    reachedMilestones(milestones, more, "2027-06-09", 10, awarded).map((r) => r.milestoneId),
    [1, 2],
  );
});

test("reachedMilestones zählt Tage der Vorsaison nicht mit", () => {
  const milestones: MilestoneRule[] = [{ id: 1, metric: "VISIT_DAYS", threshold: 2, period: "SEASON" }];
  const days: DayStat[] = [
    { day: "2026-09-01", starts: 5 },
    { day: "2027-04-01", starts: 5 },
  ];
  assert.deepEqual(reachedMilestones(milestones, days, "2027-04-01", 10, new Set()), []);
});

test("aggregateScans bildet Tagessummen in Berliner Zeit", () => {
  const rows = aggregateScans([
    { ticketId: 7, scanTime: new Date("2026-08-21T10:00:00Z") },
    { ticketId: 7, scanTime: new Date("2026-08-21T10:05:00Z") },
    // 22:30 UTC ist in Berlin (Sommerzeit) schon der 22.08.
    { ticketId: 7, scanTime: new Date("2026-08-21T22:30:00Z") },
    { ticketId: 8, scanTime: new Date("2026-08-21T11:00:00Z") },
  ]);
  const byKey = new Map(rows.map((r) => [`${r.ticketId}:${r.day}`, r]));
  assert.equal(byKey.get("7:2026-08-21")?.starts, 2);
  assert.equal(byKey.get("7:2026-08-22")?.starts, 1);
  assert.equal(byKey.get("8:2026-08-21")?.starts, 1);
  assert.equal(byKey.get("7:2026-08-21")?.lastStartAt.toISOString(), "2026-08-21T10:05:00.000Z");
});

test("benefitVoucherState", () => {
  const now = new Date("2027-06-10T12:00:00Z");
  const base = { redeemedAt: null, disabledAt: null, expiresAt: null };
  assert.equal(benefitVoucherState(base, now), "open");
  assert.equal(benefitVoucherState({ ...base, expiresAt: new Date("2027-06-09T00:00:00Z") }, now), "expired");
  assert.equal(benefitVoucherState({ ...base, disabledAt: now }, now), "disabled");
  assert.equal(benefitVoucherState({ ...base, redeemedAt: now, disabledAt: now }, now), "redeemed");
});

import { cleanNickname, mergeDayStats, milestoneProgress, sameBirthDate, seasonLevel } from "./gamification";

test("mergeDayStats: derselbe Tag aus zwei Tickets zählt einmal", () => {
  assert.deepEqual(
    mergeDayStats([
      { day: "2027-06-02", starts: 3 },
      { day: "2027-06-01", starts: 2 },
      { day: "2027-06-02", starts: 4 },
    ]),
    [
      { day: "2027-06-01", starts: 2 },
      { day: "2027-06-02", starts: 7 },
    ],
  );
});

test("milestoneProgress und seasonLevel", () => {
  const ms = [
    { id: 1, name: "Dabei", metric: "VISIT_DAYS" as const, threshold: 2, period: "SEASON" as const, voucherLabel: null },
    { id: 2, name: "Stammfahrer", metric: "VISIT_DAYS" as const, threshold: 10, period: "SEASON" as const, voucherLabel: "Freigetränk" },
    { id: 3, name: "Hundert", metric: "STARTS" as const, threshold: 100, period: "SEASON" as const, voucherLabel: null },
  ];
  const days = [
    { day: "2027-05-01", starts: 5 },
    { day: "2027-05-02", starts: 5 },
    { day: "2027-05-09", starts: 5 },
  ];
  const progress = milestoneProgress(ms, days, "2027-05-09", 10);
  assert.deepEqual(progress.map((p) => [p.value, p.reached]), [[2, true], [3, false], [15, false]]);
  const level = seasonLevel(progress);
  assert.equal(level.current?.name, "Dabei");
  assert.equal(level.next?.name, "Stammfahrer");
  assert.equal(seasonLevel([]).current, null);
});

test("sameBirthDate verträgt UTC- und Berlin-Mitternacht", () => {
  assert.equal(sameBirthDate(new Date("1990-05-17T00:00:00Z"), "1990-05-17"), true);
  assert.equal(sameBirthDate(new Date("1990-05-16T22:00:00Z"), "1990-05-17"), true);
  assert.equal(sameBirthDate(new Date("1990-05-17T00:00:00Z"), "1990-05-18"), false);
  assert.equal(sameBirthDate(null, "1990-05-17"), false);
  assert.equal(sameBirthDate(new Date("1990-05-17T00:00:00Z"), "17.05.1990"), false);
});

test("cleanNickname", () => {
  assert.equal(cleanNickname("  Wake   Fuchs "), "Wake Fuchs");
  assert.equal(cleanNickname("   "), null);
  assert.equal(cleanNickname("x".repeat(40))?.length, 20);
});

import { challengePhase, challengeValue, offerVisible, rankStandings } from "./gamification";

test("challengePhase: Start- und Endtag zählen mit", () => {
  const c = { startYmd: "2027-06-01", endYmd: "2027-06-30" };
  assert.equal(challengePhase(c, "2027-05-31"), "upcoming");
  assert.equal(challengePhase(c, "2027-06-01"), "running");
  assert.equal(challengePhase(c, "2027-06-30"), "running");
  assert.equal(challengePhase(c, "2027-07-01"), "ended");
});

test("challengeValue zählt nur den Zeitraum und deckelt Starts", () => {
  const days = [
    { day: "2027-05-31", starts: 9 },
    { day: "2027-06-01", starts: 20 },
    { day: "2027-06-15", starts: 3 },
    { day: "2027-07-01", starts: 9 },
  ];
  const range = { startYmd: "2027-06-01", endYmd: "2027-06-30" };
  assert.equal(challengeValue(days, { metric: "VISIT_DAYS", ...range }, 10), 2);
  assert.equal(challengeValue(days, { metric: "STARTS", ...range }, 10), 13);
});

test("rankStandings: Gleichstand teilt den Platz, null Punkte gewinnen nie", () => {
  const r = rankStandings(
    [
      { key: "a", value: 5 },
      { key: "b", value: 8 },
      { key: "c", value: 5 },
      { key: "d", value: 2 },
      { key: "e", value: 0 },
    ],
    2,
  );
  assert.deepEqual(r.map((s) => [s.key, s.rank, s.winner]), [
    ["b", 1, true],
    ["a", 2, true],
    ["c", 2, true],
    ["d", 4, false],
  ]);
  assert.deepEqual(rankStandings([{ key: "x", value: 0 }], 3), []);
});

test("offerVisible beachtet Schalter und Zeitraum", () => {
  assert.equal(offerVisible({ active: true, fromYmd: null, toYmd: null }, "2027-06-01"), true);
  assert.equal(offerVisible({ active: false, fromYmd: null, toYmd: null }, "2027-06-01"), false);
  assert.equal(offerVisible({ active: true, fromYmd: "2027-06-02", toYmd: null }, "2027-06-01"), false);
  assert.equal(offerVisible({ active: true, fromYmd: null, toYmd: "2027-06-01" }, "2027-06-01"), true);
  assert.equal(offerVisible({ active: true, fromYmd: null, toYmd: "2027-05-31" }, "2027-06-01"), false);
});

import { aheadOfPercent, seasonRecap } from "./gamification";

test("seasonRecap: stärkster Monat, Lieblingstag, Serie und bester Tag", () => {
  const recap = seasonRecap([
    { day: "2026-08-22", starts: 4 }, // Samstag
    { day: "2026-09-05", starts: 9 }, // Samstag
    { day: "2026-09-12", starts: 3 }, // Samstag
    { day: "2026-09-16", starts: 2 }, // Mittwoch
    { day: "2026-09-20", starts: 0 },
  ]);
  assert.equal(recap.visitDays, 4);
  assert.equal(recap.starts, 18);
  assert.deepEqual(recap.bestMonth, { name: "September", visitDays: 3 });
  assert.deepEqual(recap.bestWeekday, { name: "Samstag", visitDays: 3 });
  assert.deepEqual(recap.bestDay, { day: "2026-09-05", starts: 9 });
  assert.equal(recap.streakWeeks, 3);
  assert.equal(recap.firstDay, "2026-08-22");
  assert.equal(recap.lastDay, "2026-09-16");
});

test("seasonRecap ohne Besuche und aheadOfPercent", () => {
  const empty = seasonRecap([]);
  assert.equal(empty.visitDays, 0);
  assert.equal(empty.bestMonth, null);
  assert.equal(empty.bestDay, null);
  assert.equal(aheadOfPercent(5, [1, 2, 3]), null);
  assert.equal(aheadOfPercent(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 40);
});
