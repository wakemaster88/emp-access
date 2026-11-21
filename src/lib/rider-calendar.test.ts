import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDayLabel, calendarMonth, calendarMonthKey, shortTime } from "./rider-calendar";
import type { ScheduleSpec } from "./operating-hours";

const lift: ScheduleSpec = {
  name: "Wasserski & Shop",
  seasons: [
    {
      name: "November",
      startMmDd: "11-01",
      endMmDd: "11-30",
      sortOrder: 0,
      periods: [5, 6].map((weekday) => ({ weekday, opensAt: "12:00", closesAt: "16:00" })),
    },
  ],
  exceptions: [
    { date: "2026-11-28", closed: true, opensAt: null, closesAt: null, note: "Eisbaden" },
    { date: "2026-12-06", closed: false, opensAt: "12:00", closesAt: "16:30", note: "Nikolaus" },
  ],
};

test("shortTime: volle Stunden ohne Minuten", () => {
  assert.equal(shortTime("12:00"), "12");
  assert.equal(shortTime("09:30"), "9:30");
});

test("calendarMonthKey: nur ein Monat zurück und zwölf voraus", () => {
  assert.equal(calendarMonthKey(undefined, "2026-11-21"), "2026-11");
  assert.equal(calendarMonthKey("2026-10", "2026-11-21"), "2026-10");
  assert.equal(calendarMonthKey("2026-09", "2026-11-21"), "2026-11");
  assert.equal(calendarMonthKey("2027-11", "2026-11-21"), "2027-11");
  assert.equal(calendarMonthKey("2027-12", "2026-11-21"), "2026-11");
  assert.equal(calendarMonthKey("2026-13", "2026-11-21"), "2026-11");
});

test("calendarMonth: offene Tage, Ausnahmen und Liste ab heute", () => {
  const m = calendarMonth(lift, "2026-11", "2026-11-21");
  assert.equal(m.title, "November 2026");
  const days = m.weeks.flat();
  const sat = days.find((d) => d.ymd === "2026-11-21")!;
  assert.equal(sat.open, true);
  assert.equal(sat.hours, "12–16");
  assert.equal(sat.today, true);
  const closed = days.find((d) => d.ymd === "2026-11-28")!;
  assert.equal(closed.open, false);
  assert.equal(closed.exception, true);
  assert.equal(closed.note, "Eisbaden");
  assert.deepEqual(
    m.list.map((d) => d.ymd),
    ["2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29"],
  );
  assert.equal(m.prev, "2026-10");
  assert.equal(m.next, "2026-12");
});

test("calendarMonth: Ausnahmetag außerhalb der Saison ist offen", () => {
  const m = calendarMonth(lift, "2026-12", "2026-11-21");
  assert.deepEqual(m.list.map((d) => [d.ymd, d.hours, d.note]), [["2026-12-06", "12–16:30", "Nikolaus"]]);
});

test("calendarMonth: am Rand des Blätterbereichs kein Weiter", () => {
  assert.equal(calendarMonth(lift, "2026-10", "2026-11-21").prev, null);
  assert.equal(calendarMonth(lift, "2027-11", "2026-11-21").next, null);
});

test("calendarDayLabel", () => {
  assert.equal(calendarDayLabel("2026-11-21"), "Sa, 21.11.");
});
