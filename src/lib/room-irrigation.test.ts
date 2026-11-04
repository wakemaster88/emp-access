import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketRunsByDay, fmtNextRun, nextScheduleRun, runProgress } from "./room-irrigation";

const TZ = "Europe/Berlin";
// Donnerstag, 5.11.2026, 10:17 Ortszeit (09:17 UTC).
const NOW = new Date("2026-11-05T09:17:30Z");

test("nextScheduleRun findet heute, morgen und den nächsten Wochentag", () => {
  // Jeden Tag 18:00 → heute.
  const today = nextScheduleRun({ daysOfWeek: 127, startTime: "18:00", isActive: true }, NOW, TZ);
  assert.equal(today?.toISOString(), "2026-11-05T17:00:00.000Z");
  // Jeden Tag 05:30 → schon vorbei, also morgen.
  const tomorrow = nextScheduleRun({ daysOfWeek: 127, startTime: "05:30", isActive: true }, NOW, TZ);
  assert.equal(tomorrow?.toISOString(), "2026-11-06T04:30:00.000Z");
  // Nur montags (bit0) → Montag, 9.11.
  const monday = nextScheduleRun({ daysOfWeek: 1, startTime: "06:00", isActive: true }, NOW, TZ);
  assert.equal(monday?.toISOString(), "2026-11-09T05:00:00.000Z");
  assert.equal(nextScheduleRun({ daysOfWeek: 127, startTime: "06:00", isActive: false }, NOW, TZ), null);
  assert.equal(nextScheduleRun({ daysOfWeek: 0, startTime: "06:00", isActive: true }, NOW, TZ), null);
});

test("fmtNextRun spricht von heute, morgen und dem Wochentag", () => {
  assert.equal(fmtNextRun(new Date("2026-11-05T17:00:00Z"), NOW, TZ), "heute 18:00");
  assert.equal(fmtNextRun(new Date("2026-11-06T04:30:00Z"), NOW, TZ), "morgen 05:30");
  assert.equal(fmtNextRun(new Date("2026-11-09T05:00:00Z"), NOW, TZ), "Mo 06:00");
});

test("bucketRunsByDay liefert sieben Tage, heute zuletzt, in Ortszeit", () => {
  const days = bucketRunsByDay(
    [
      // 4.11. 23:30 Ortszeit = 22:30 UTC → gestern.
      { startedAt: new Date("2026-11-04T22:30:00Z"), durationMinutes: 15, litersEstimate: 180 },
      { startedAt: new Date("2026-11-05T04:30:00Z"), durationMinutes: 10, litersEstimate: 120.4 },
      { startedAt: new Date("2026-10-20T04:30:00Z"), durationMinutes: 10, litersEstimate: 999 },
    ],
    NOW,
    TZ,
  );
  assert.equal(days.length, 7);
  assert.equal(days[0].date, "2026-10-30");
  assert.equal(days[6].date, "2026-11-05");
  assert.deepEqual(days[5], { date: "2026-11-04", liters: 180, minutes: 15, runs: 1 });
  assert.deepEqual(days[6], { date: "2026-11-05", liters: 120, minutes: 10, runs: 1 });
  assert.equal(days.reduce((s, d) => s + d.liters, 0), 300);
});

test("runProgress zählt fertige Schritte, Rest und Liter", () => {
  const valves = [
    { id: 1, name: "Liegewiese", isActive: true, flowLph: 600 },
    { id: 2, name: "Beach", isActive: true, flowLph: null },
    { id: 3, name: "Beete", isActive: true, flowLph: null },
  ];
  const run = {
    steps: [
      { deviceId: 1, name: "Liegewiese", minutes: 15, startedAt: "2026-11-05T08:50:00Z" },
      { deviceId: 2, name: "Beach", minutes: 10, startedAt: "2026-11-05T09:12:30Z" },
      { deviceId: 3, name: "Beete", minutes: 10, startedAt: null },
    ],
  };
  const p = runProgress(run, valves, NOW.getTime());
  assert.equal(p.done, 1);
  assert.equal(p.current, 1);
  assert.equal(p.total, 3);
  assert.equal(p.remainingSec, 300);
  // 15 Min × 10 l/Min = 150 l fertig, dazu die Hälfte von 10 Min × 12 l/Min.
  assert.equal(p.litersSoFar, 210);
  assert.equal(p.finished, false);
});
