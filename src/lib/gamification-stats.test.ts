import { test } from "node:test";
import assert from "node:assert/strict";
import { awardReach, bucketize, groupPersonDays, monthRows } from "./gamification-stats";
import type { MilestoneRule } from "./gamification";

const rule = (id: number, metric: MilestoneRule["metric"], threshold: number, period: MilestoneRule["period"]): MilestoneRule => ({
  id, metric, threshold, period, eventDays: [], tempBelow: null,
});

test("groupPersonDays: Tickets derselben Person am selben Tag ergeben einen Tag", () => {
  const persons = groupPersonDays([
    { person: "p1", day: "2026-05-02", starts: 3 },
    { person: "p1", day: "2026-05-02", starts: 2 },
    { person: "p1", day: "2026-05-01", starts: 1 },
    { person: "t9", day: "2026-06-01", starts: 4 },
  ], new Map([["p1", 2020]]));
  assert.deepEqual(persons, [
    { key: "p1", days: [{ day: "2026-05-01", starts: 1 }, { day: "2026-05-02", starts: 5 }], ridingSince: 2020 },
    { key: "t9", days: [{ day: "2026-06-01", starts: 4 }], ridingSince: null },
  ]);
});

test("awardReach: zählt Personen je Award, Starts je Tag gedeckelt, Wasser/Frühstart nicht nachrechenbar", () => {
  const persons = groupPersonDays([
    ...Array.from({ length: 6 }, (_, i) => ({ person: "a", day: `2026-07-0${i + 1}`, starts: 20 })),
    { person: "b", day: "2026-07-01", starts: 1 },
    { person: "c", day: "2025-07-01", starts: 30 },
  ]);
  const reach = awardReach(
    persons,
    [rule(1, "VISIT_DAYS", 5, "SEASON"), rule(2, "STARTS", 25, "ALL_TIME"), rule(3, "COLD_DAYS", 1, "SEASON"), rule(4, "STARTS", 1, "ALL_TIME")],
    "2026-11-22",
    10,
  );
  assert.deepEqual(reach, [
    { milestoneId: 1, reached: 1 },
    // a: 6 × 10 = 60; c: 30 → 10 gedeckelt.
    { milestoneId: 2, reached: 1 },
    { milestoneId: 3, reached: null },
    { milestoneId: 4, reached: 3 },
  ]);
});

test("bucketize: Bereiche aus den Award-Zielen", () => {
  assert.deepEqual(bucketize([1, 4, 5, 14, 15, 60], [1, 5, 15, 50], "Tage"), [
    { label: "1 bis 4 Tage", count: 2 },
    { label: "5 bis 14 Tage", count: 2 },
    { label: "15 bis 49 Tage", count: 1 },
    { label: "ab 50 Tage", count: 1 },
  ]);
  assert.deepEqual(bucketize([1, 2], [1, 2], "Tage"), [
    { label: "1 Tage", count: 1 },
    { label: "ab 2 Tage", count: 1 },
  ]);
});

test("monthRows: Personen, Tage und Starts je Monat des Jahres", () => {
  const persons = groupPersonDays([
    { person: "a", day: "2026-07-01", starts: 12 },
    { person: "a", day: "2026-07-02", starts: 3 },
    { person: "b", day: "2026-07-02", starts: 2 },
    { person: "b", day: "2026-08-02", starts: 1 },
    { person: "b", day: "2025-08-02", starts: 1 },
  ]);
  assert.deepEqual(monthRows(persons, "2026", 10), [
    { month: "2026-07", persons: 2, visitDays: 3, starts: 15 },
    { month: "2026-08", persons: 1, visitDays: 1, starts: 1 },
  ]);
});
