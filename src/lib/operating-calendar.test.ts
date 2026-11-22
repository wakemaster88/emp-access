import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addMonthsToYmd,
  daySegments,
  describeWeekPlan,
  groupByHours,
  membersLabel,
  hourRange,
  isoWeek,
  monthGrid,
  monthTitle,
  weekDays,
  weekTitle,
} from "./operating-calendar";
import type { ScheduleSpec } from "./operating-hours";

test("monthGrid: November 2026 beginnt Montag 26.10. und endet Sonntag 06.12.", () => {
  const grid = monthGrid("2026-11-20");
  assert.equal(grid.length, 6);
  assert.equal(grid[0][0], "2026-10-26");
  assert.equal(grid[0][6], "2026-11-01");
  assert.equal(grid[5][6], "2026-12-06");
  assert.ok(grid.every((w) => w.length === 7));
});

test("monthGrid: Februar 2027 beginnt an einem Montag und hat vier Wochen", () => {
  const grid = monthGrid("2027-02-10");
  assert.equal(grid.length, 4);
  assert.equal(grid[0][0], "2027-02-01");
  assert.equal(grid[3][6], "2027-02-28");
});

test("addMonthsToYmd über den Jahreswechsel", () => {
  assert.equal(addMonthsToYmd("2026-12-15", 1), "2027-01-01");
  assert.equal(addMonthsToYmd("2027-01-31", -1), "2026-12-01");
  assert.equal(addMonthsToYmd("2026-11-20", 0), "2026-11-01");
});

test("weekDays und Titel", () => {
  assert.deepEqual(weekDays("2026-11-20"), [
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
    "2026-11-22",
  ]);
  assert.equal(isoWeek("2026-11-20"), 47);
  assert.equal(isoWeek("2027-01-01"), 53);
  assert.equal(isoWeek("2027-01-04"), 1);
  assert.equal(weekTitle("2026-11-20"), "KW 47 · 16.11.–22.11.2026");
  assert.equal(monthTitle("2026-03-01"), "März 2026");
});

const bar: ScheduleSpec = {
  name: "Bar",
  seasons: [
    {
      name: "Ganzjährig",
      startMmDd: "01-01",
      endMmDd: "12-31",
      sortOrder: 0,
      periods: [
        // Freitag 18:00–02:00, Samstag 10:00–14:00 und 17:00–20:00
        { weekday: 4, opensAt: "18:00", closesAt: "02:00" },
        { weekday: 5, opensAt: "17:00", closesAt: "20:00" },
        { weekday: 5, opensAt: "10:00", closesAt: "14:00" },
      ],
    },
  ],
  exceptions: [{ date: "2026-11-27", closed: true, opensAt: null, closesAt: null, note: "Betriebsfeier" }],
};

test("daySegments: Spanne über Mitternacht teilt sich auf zwei Tage", () => {
  assert.deepEqual(daySegments(bar, "2026-11-20"), [{ start: 18 * 60, end: 24 * 60 }]);
  assert.deepEqual(daySegments(bar, "2026-11-21"), [
    { start: 0, end: 2 * 60 },
    { start: 10 * 60, end: 14 * 60 },
    { start: 17 * 60, end: 20 * 60 },
  ]);
  assert.deepEqual(daySegments(bar, "2026-11-19"), []);
});

test("daySegments: geschlossener Ausnahmetag unterbricht auch den Folgetag", () => {
  assert.deepEqual(daySegments(bar, "2026-11-27"), []);
  assert.deepEqual(daySegments(bar, "2026-11-28"), [
    { start: 10 * 60, end: 14 * 60 },
    { start: 17 * 60, end: 20 * 60 },
  ]);
});

test("hourRange", () => {
  assert.deepEqual(hourRange([]), { from: 8, to: 20 });
  assert.deepEqual(hourRange([{ start: 9 * 60 + 30, end: 18 * 60 + 15 }]), { from: 9, to: 19 });
  assert.deepEqual(hourRange([{ start: 0, end: 120 }, { start: 600, end: 1440 }]), { from: 0, to: 24 });
});

test("describeWeekPlan: gleiche Zeiten zusammengefasst", () => {
  const p = (weekday: number, opensAt: string, closesAt: string) => ({ weekday, opensAt, closesAt });
  assert.equal(describeWeekPlan([p(5, "12:00", "16:00"), p(6, "12:00", "16:00")]), "Sa/So 12–16");
  assert.equal(
    describeWeekPlan([1, 2, 3, 4].map((d) => p(d, "16:00", "20:00")).concat([p(5, "12:00", "20:00"), p(6, "12:00", "20:00")])),
    "Di–Fr 16–20 · Sa/So 12–20",
  );
  assert.equal(describeWeekPlan([0, 1, 2, 3, 4, 5, 6].map((d) => p(d, "10:00", "20:00"))), "täglich 10–20");
  assert.equal(describeWeekPlan([p(0, "10:00", "12:30"), p(2, "10:00", "12:30")]), "Mo, Mi 10–12:30");
  assert.equal(describeWeekPlan([]), "geschlossen");
});

test("groupByHours: gleiche Zeiten zusammen, geschlossene weg, Ausnahmen getrennt", () => {
  const open = (o: string, c: string, exception = false) => ({
    ymd: "2027-03-29",
    closed: false,
    windows: [{ opensAt: o, closesAt: c, overnight: false }],
    source: exception ? ("exception" as const) : ("season" as const),
    label: null,
  });
  const closed = { ymd: "2027-03-29", closed: true, windows: [], source: "none" as const, label: null };
  const groups = groupByHours([
    { item: "Wasserski", day: open("12:00", "18:00", true) },
    { item: "Shop", day: open("12:00", "18:00", true) },
    { item: "Gastronomie", day: open("12:00", "20:00", true) },
    { item: "Strandbad", day: closed },
    { item: "SUP", day: open("10:00", "20:00") },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.hours, g.exception, g.members]),
    [
      ["10–20", false, ["SUP"]],
      ["12–18", true, ["Wasserski", "Shop"]],
      ["12–20", true, ["Gastronomie"]],
    ],
  );
});

test("membersLabel: alle, alle außer, Namen", () => {
  const all = ["Wasserski", "Shop", "Gastronomie", "Strandbad", "Aquapark", "SUP", "Grillplatz"];
  assert.equal(membersLabel(all, all), "alle");
  assert.equal(membersLabel(all.filter((n) => n !== "Wasserski"), all), "alle außer Wasserski");
  assert.equal(membersLabel(["Wasserski", "Shop"], all), "Wasserski, Shop");
  assert.equal(membersLabel(["Gastronomie"], ["Gastronomie"]), "Gastronomie");
});
