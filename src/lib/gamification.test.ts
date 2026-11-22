import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_TIME_KEY,
  aggregateScans,
  awardKey,
  benefitVoucherState,
  computeMetrics,
  currentWeekStreak,
  inPeriod,
  isWeekendDay,
  longestWeekStreak,
  longestWeekendStreak,
  milestoneConditionText,
  openingDayOf,
  periodKey,
  reachedMilestones,
  ruleValue,
  seasonsCount,
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
  assert.deepEqual(computeMetrics(days, 10), { visitDays: 2, starts: 14, streakWeeks: 1, earlyDays: 0, weekends: 0 });
  assert.equal(computeMetrics(days, 0).starts, 37);
});

test("computeMetrics zählt frühe Tage und Wochenenden in Folge", () => {
  // 2027-06-05/06 und 12 sind Samstag/Sonntag, der 19.06. fehlt, 26.06. ist wieder ein Samstag.
  const days: DayStat[] = [
    { day: "2027-06-05", starts: 3, early: true },
    { day: "2027-06-06", starts: 2 },
    { day: "2027-06-09", starts: 4, early: true },
    { day: "2027-06-12", starts: 1 },
    { day: "2027-06-26", starts: 1, early: true },
    { day: "2027-06-27", starts: 0, early: true },
  ];
  const m = computeMetrics(days, 10);
  assert.equal(m.earlyDays, 3);
  assert.equal(m.weekends, 2);
  assert.equal(isWeekendDay("2027-06-05"), true);
  assert.equal(isWeekendDay("2027-06-07"), false);
  // Zwei Tage desselben Wochenendes zählen einmal, Wochentage gar nicht.
  assert.equal(longestWeekendStreak(["2027-06-05", "2027-06-06", "2027-06-09"]), 1);
  assert.equal(longestWeekendStreak(["2027-06-06", "2027-06-12", "2027-06-19"]), 3);
});

test("periodKey und inPeriod: Awards ohne Zeitraum zählen alle Jahre", () => {
  assert.equal(periodKey("ALL_TIME", "2027-06-14"), ALL_TIME_KEY);
  assert.equal(inPeriod("2024-08-01", "ALL_TIME", "2027-06-14"), true);
  assert.equal(inPeriod("2026-08-01", "SEASON", "2027-06-14"), false);
  assert.equal(inPeriod("2027-05-31", "MONTH", "2027-06-14"), false);
  assert.equal(inPeriod("2027-06-01", "MONTH", "2027-06-14"), true);
});

test("ruleValue: Starts über alle Jahre, Aktionstage und Saisons", () => {
  const days: DayStat[] = [
    { day: "2026-08-01", starts: 40 },
    { day: "2026-09-12", starts: 5 },
    { day: "2027-04-03", starts: 12 },
    { day: "2027-11-20", starts: 2 },
  ];
  const ctx = { capPerDay: 30 };
  assert.equal(ruleValue({ metric: "STARTS", period: "ALL_TIME" }, days, "2027-11-20", ctx), 49);
  assert.equal(ruleValue({ metric: "STARTS", period: "SEASON" }, days, "2027-11-20", ctx), 14);
  assert.equal(ruleValue({ metric: "VISIT_DAYS", period: "SEASON" }, days, "2027-11-20", ctx), 2);
  // Aktionstage: nur Tage der Liste, an denen die Person wirklich gestartet ist, und nur im Zeitraum.
  const opening = { metric: "EVENT_DAYS" as const, period: "SEASON" as const, eventDays: ["2026-08-01", "2027-04-03", "2027-04-04"] };
  assert.equal(ruleValue(opening, days, "2027-11-20", ctx), 1);
  assert.equal(ruleValue({ ...opening, eventDays: [] }, days, "2027-11-20", ctx), 0);
  assert.equal(ruleValue({ metric: "EVENT_DAYS", period: "SEASON" }, days, "2027-11-20", ctx), 0);
  // Saisons: aus den Tagessummen oder vorgegeben.
  assert.equal(ruleValue({ metric: "SEASONS", period: "ALL_TIME" }, days, "2027-11-20", ctx), 2);
  assert.equal(ruleValue({ metric: "SEASONS", period: "ALL_TIME" }, days, "2027-11-20", { capPerDay: 30, seasons: 6 }), 6);
});

test("ruleValue: erster Tag der Saison automatisch, ein eingetragener Tag geht vor", () => {
  const days: DayStat[] = [
    { day: "2026-05-09", starts: 4 },
    { day: "2027-03-27", starts: 3 },
    { day: "2027-04-03", starts: 0 },
    { day: "2027-06-01", starts: 2 },
  ];
  const openingDays = { "2026": "2026-05-09", "2027": "2027-03-27" };
  const rule = { metric: "OPENING_DAY" as const, period: "SEASON" as const };
  // Am ersten Tag 2027 gestartet: zählt in der Saison 2027, die Vorsaison zählt dort nicht mit.
  assert.equal(ruleValue(rule, days, "2027-06-01", { capPerDay: 10, openingDays }), 1);
  assert.equal(ruleValue({ ...rule, period: "ALL_TIME" }, days, "2027-06-01", { capPerDay: 10, openingDays }), 2);
  // Ohne ermittelten Tag (noch niemand gefahren) gibt es nichts.
  assert.equal(ruleValue(rule, days, "2027-06-01", { capPerDay: 10 }), 0);
  // Am ersten Tag nur ein Eintrag ohne Start: zählt nicht.
  assert.equal(ruleValue(rule, days, "2027-06-01", { capPerDay: 10, openingDays: { "2027": "2027-04-03" } }), 0);
  // Das Personal legt den Tag fest: der eingetragene Tag ersetzt den automatischen seines Jahres.
  assert.equal(ruleValue({ ...rule, eventDays: ["2027-06-01"] }, days, "2027-06-01", { capPerDay: 10, openingDays }), 1);
  assert.equal(ruleValue({ ...rule, eventDays: ["2027-05-01"] }, days, "2027-06-01", { capPerDay: 10, openingDays }), 0);
  // Ein Eintrag für ein anderes Jahr lässt den automatischen Tag stehen.
  assert.equal(ruleValue({ ...rule, eventDays: ["2026-04-01"] }, days, "2027-06-01", { capPerDay: 10, openingDays }), 1);
  assert.equal(openingDayOf("2027", ["2027-04-10", "2027-04-02", "2026-03-01"], openingDays), "2027-04-02");
  assert.equal(openingDayOf("2027", [], openingDays), "2027-03-27");
  assert.equal(openingDayOf("2028", undefined, openingDays), null);
});

test("ruleValue: Tage mit kaltem Wasser zählen nur mit Messwert unter der Grenze", () => {
  const days: DayStat[] = [
    { day: "2026-11-07", starts: 3, waterTemp: 10.4 },
    { day: "2026-11-14", starts: 2, waterTemp: 9.6 },
    { day: "2026-11-15", starts: 0, waterTemp: 9.1 },
    { day: "2026-11-20", starts: 5 },
    { day: "2026-11-21", starts: 1, waterTemp: 10 },
    { day: "2025-11-30", starts: 4, waterTemp: 6.5 },
  ];
  const ctx = { capPerDay: 10 };
  const rule = { metric: "COLD_DAYS" as const, period: "SEASON" as const, tempBelow: 10 };
  // Genau 10 Grad ist nicht kälter als 10, ein Tag ohne Messwert oder ohne Start zählt nicht.
  assert.equal(ruleValue(rule, days, "2026-11-21", ctx), 1);
  assert.equal(ruleValue({ ...rule, tempBelow: 10.5 }, days, "2026-11-21", ctx), 3);
  assert.equal(ruleValue({ ...rule, period: "ALL_TIME" }, days, "2026-11-21", ctx), 2);
  // Ohne Grenze wird nichts vergeben.
  assert.equal(ruleValue({ metric: "COLD_DAYS", period: "SEASON" }, days, "2026-11-21", ctx), 0);
  assert.equal(ruleValue({ ...rule, tempBelow: null }, days, "2026-11-21", ctx), 0);
});

test("mergeDayStats: Starts addieren, beim Wasser gilt der kälteste Wert", () => {
  assert.deepEqual(
    mergeDayStats([
      { day: "2026-11-14", starts: 2, waterTemp: 9.8 },
      { day: "2026-11-07", starts: 1 },
      { day: "2026-11-14", starts: 3, early: true, waterTemp: 9.4 },
      { day: "2026-11-07", starts: 1, waterTemp: 10.2 },
    ]),
    [
      { day: "2026-11-07", starts: 2, waterTemp: 10.2 },
      { day: "2026-11-14", starts: 5, early: true, waterTemp: 9.4 },
    ],
  );
  assert.deepEqual(mergeDayStats([{ day: "2026-11-07", starts: 1, early: false }]), [{ day: "2026-11-07", starts: 1 }]);
});

test("milestoneConditionText: Bedingung in Worten", () => {
  assert.equal(milestoneConditionText({ metric: "VISIT_DAYS", threshold: 10, period: "SEASON" }), "10 Besuchstage · Saison");
  assert.equal(milestoneConditionText({ metric: "OPENING_DAY", threshold: 1, period: "SEASON" }), "Erster Tag der Saison · Saison");
  assert.equal(milestoneConditionText({ metric: "COLD_DAYS", threshold: 1, period: "SEASON", tempBelow: 10 }), "1 Tag mit Wasser unter 10 °C · Saison");
  assert.equal(milestoneConditionText({ metric: "COLD_DAYS", threshold: 3, period: "SEASON", tempBelow: 9.5 }), "3 Tage mit Wasser unter 9,5 °C · Saison");
});

test("seasonsCount: Jahre mit Start, dazu die Jahre seit „Fährt seit“", () => {
  const days: DayStat[] = [
    { day: "2026-08-01", starts: 3 },
    { day: "2027-04-03", starts: 0 },
    { day: "2028-05-01", starts: 2 },
  ];
  assert.equal(seasonsCount([], 2015, "2028-06-01"), 0);
  assert.equal(seasonsCount(days, null, "2028-06-01"), 2);
  // Stichtag vor dem Start 2028: nur 2026 zählt.
  assert.equal(seasonsCount(days, null, "2027-12-31"), 1);
  // Seit 2021 dabei: 2021 bis 2025 kommen lückenlos dazu.
  assert.equal(seasonsCount(days, 2021, "2028-06-01"), 7);
  // Ein Jahr nach dem ersten gezählten Start ändert nichts, Unsinn auch nicht.
  assert.equal(seasonsCount(days, 2027, "2028-06-01"), 2);
  assert.equal(seasonsCount(days, 12, "2028-06-01"), 2);
});

test("reachedMilestones: Awards über alle Jahre werden nur einmal vergeben", () => {
  const milestones: MilestoneRule[] = [
    { id: 1, metric: "STARTS", threshold: 25, period: "ALL_TIME" },
    { id: 2, metric: "SEASONS", threshold: 2, period: "ALL_TIME" },
    { id: 3, metric: "SEASONS", threshold: 5, period: "ALL_TIME" },
    { id: 4, metric: "EVENT_DAYS", threshold: 1, period: "SEASON", eventDays: ["2027-04-03"] },
    { id: 5, metric: "EARLY_DAYS", threshold: 1, period: "SEASON" },
    { id: 6, metric: "OPENING_DAY", threshold: 1, period: "SEASON" },
    { id: 7, metric: "COLD_DAYS", threshold: 1, period: "SEASON", tempBelow: 10 },
  ];
  const days: DayStat[] = [
    { day: "2026-08-01", starts: 20, early: true },
    { day: "2027-04-03", starts: 6, waterTemp: 8.7 },
  ];
  assert.deepEqual(reachedMilestones(milestones, days, "2027-04-03", 100, new Set()), [
    { milestoneId: 1, periodKey: ALL_TIME_KEY },
    { milestoneId: 2, periodKey: ALL_TIME_KEY },
    { milestoneId: 4, periodKey: "2027" },
    { milestoneId: 7, periodKey: "2027" },
  ]);
  // Mit dem ersten Tag der Saison kommt Day One dazu.
  assert.deepEqual(
    reachedMilestones(milestones, days, "2027-04-03", 100, new Set(), undefined, { "2027": "2027-04-03" }).map((r) => r.milestoneId),
    [1, 2, 4, 6, 7],
  );
  // Im Jahr darauf: der Award über alle Jahre ist schon vergeben, der Aktionstag der Vorsaison zählt nicht neu.
  const awarded = new Set([awardKey(1, ALL_TIME_KEY), awardKey(2, ALL_TIME_KEY), awardKey(4, "2027")]);
  const later = [...days, { day: "2028-05-01", starts: 1 }];
  assert.deepEqual(reachedMilestones(milestones, later, "2028-05-01", 100, awarded), []);
  // Mit „Fährt seit 2023“ sind es 2023 bis 2028 und damit sechs Saisons.
  assert.deepEqual(
    reachedMilestones(milestones, later, "2028-05-01", 100, awarded, seasonsCount(later, 2023, "2028-05-01")),
    [{ milestoneId: 3, periodKey: ALL_TIME_KEY }],
  );
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
  // Früh war die Person, wenn es eines ihrer Tickets an dem Tag war.
  const merged = mergeDayStats([
    { day: "2027-06-02", starts: 3 },
    { day: "2027-06-02", starts: 4, early: true },
    { day: "2027-06-03", starts: 1, early: false },
  ]);
  assert.deepEqual(merged.map((d) => !!d.early), [true, false]);
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

test("challengePhase: mit Uhrzeit endet die Challenge am Endtag um diese Zeit", () => {
  const c = { startYmd: "2026-12-06", endYmd: "2026-12-06", endTime: "18:00" };
  assert.equal(challengePhase(c, "2026-12-06", "09:00"), "running");
  assert.equal(challengePhase(c, "2026-12-06", "17:59"), "running");
  assert.equal(challengePhase(c, "2026-12-06", "18:00"), "ended");
  assert.equal(challengePhase(c, "2026-12-07", "08:00"), "ended");
  assert.equal(challengePhase({ ...c, endTime: null }, "2026-12-06", "23:59"), "running");
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

test("renewalHint: 30 Tage vorher, nach Ablauf, sonst nichts", async () => {
  const { renewalHint } = await import("./gamification");
  const now = new Date("2027-09-01T10:00:00Z");
  assert.equal(renewalHint(null, now), null);
  assert.equal(renewalHint(new Date("2027-12-31T22:59:00Z"), now), null);
  assert.deepEqual(renewalHint(new Date("2027-09-13T10:00:00Z"), now), { kind: "soon", days: 12 });
  assert.deepEqual(renewalHint(new Date("2027-10-01T10:00:00Z"), now), { kind: "soon", days: 30 });
  assert.equal(renewalHint(new Date("2027-10-01T10:00:01Z"), now), null);
  assert.deepEqual(renewalHint(new Date("2027-09-01T09:59:00Z"), now), { kind: "expired" });
});

test("parsePriceMap und aboCalculation: nur echte Zahlen", async () => {
  const { parsePriceMap, aboCalculation, formatEuro } = await import("./gamification");
  const prices = parsePriceMap({ "3": 2500, "4": 0, x: 100, "5": "12", "6": 19.5 });
  assert.deepEqual([...prices.entries()], [[3, 2500]]);
  assert.equal(parsePriceMap(null).size, 0);
  assert.equal(parsePriceMap([1, 2]).size, 0);

  const abos = [{ name: "Ride + Gear", cents: 59000 }, { name: "Ride", cents: 39000 }];
  assert.equal(aboCalculation(2, [2500, 2500], abos), null);
  assert.equal(aboCalculation(3, [2500, null, 2500], abos), null);
  assert.equal(aboCalculation(3, [2500, 2500, 2500], []), null);
  assert.deepEqual(aboCalculation(3, [2500, 3500, 2500], abos), {
    tickets: 3, spentCents: 8500, aboName: "Ride", aboCents: 39000,
  });
  assert.equal(formatEuro(39000).replace(/\s/g, " "), "390 €");
  assert.equal(formatEuro(2450).replace(/\s/g, " "), "24,50 €");
});

test("tempStat und tempStatNote: Mittel über die Tage mit Messwert", async () => {
  const { tempStat, tempStatNote } = await import("./gamification");
  assert.equal(tempStat([]), null);
  assert.equal(tempStat([null, undefined, Number.NaN]), null);

  const air = tempStat([9.82, 24.52, 21.04, null]);
  assert.deepEqual(air, { avg: 18.5, min: 9.8, max: 24.5, days: 3 });
  // Alle Besuchstage gemessen: die Spanne. Sonst steht da, wie viele Tage fehlen.
  assert.equal(tempStatNote(air!, 3), "zwischen 10 und 25 °C");
  assert.equal(tempStatNote(air!, 4), "gemessen an 3 von 4 Tagen");

  assert.equal(tempStatNote(tempStat([10.2, 10.4])!, 2), "an allen 2 Tagen");
  assert.equal(tempStatNote(tempStat([24.4])!, 1), "an deinem Tag am Lift");
  assert.equal(tempStatNote(tempStat([-0.3, 4.6])!, 2), "zwischen 0 und 5 °C");
});

test("startScanWhere: heutige Start-Geräte ganz, frühere nur bis zum Stichtag", async () => {
  const { startScanWhere } = await import("./gamification");
  const until = new Date("2026-08-20T22:00:00.000Z");
  assert.equal(startScanWhere([]), null);
  assert.deepEqual(
    startScanWhere([
      { id: 84, countsAsStart: true, legacyStartsUntil: null },
      { id: 6, countsAsStart: false, legacyStartsUntil: until },
    ]),
    { OR: [{ deviceId: { in: [84] } }, { deviceId: 6, scanTime: { lt: until } }] },
  );
  // Heute Start-Gerät: der Stichtag spielt keine Rolle mehr.
  assert.deepEqual(startScanWhere([{ id: 84, countsAsStart: true, legacyStartsUntil: until }]), {
    OR: [{ deviceId: { in: [84] } }],
  });
  assert.deepEqual(startScanWhere([{ id: 6, countsAsStart: false, legacyStartsUntil: until }]), {
    OR: [{ deviceId: 6, scanTime: { lt: until } }],
  });
});
