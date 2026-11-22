import assert from "node:assert/strict";
import { test } from "node:test";
import { daylightDay, daylightSlotStates, overlaps } from "./verein-daylight";

// Tuttenbrocksee (Konto-Standort)
const LAT = 51.756;
const LNG = 8.043;

test("daylightDay: Dezember, volle Stunden zwischen Sonnenauf- und -untergang", () => {
  const day = daylightDay("2026-12-06", LAT, LNG, 60);
  assert.ok(day.sunrise && day.sunrise >= "08:15" && day.sunrise <= "08:35", `Sonnenaufgang ${day.sunrise}`);
  assert.ok(day.sunset && day.sunset >= "16:05" && day.sunset <= "16:25", `Sonnenuntergang ${day.sunset}`);
  assert.equal(day.slots[0].startTime, "09:00");
  assert.equal(day.slots.at(-1)?.endTime, "16:00");
  assert.equal(day.slots.length, 7);
  // Winterzeit: 09:00 Berlin = 08:00 UTC
  assert.equal(day.slots[0].startIso, "2026-12-06T08:00:00.000Z");
  assert.equal(day.slots[0].endIso, "2026-12-06T09:00:00.000Z");
});

test("daylightDay: Juni, lange Tage und Sommerzeit", () => {
  const day = daylightDay("2027-06-21", LAT, LNG, 60);
  assert.equal(day.slots[0].startTime, "06:00");
  assert.ok(day.sunset && day.sunset >= "21:45", `Sonnenuntergang ${day.sunset}`);
  assert.equal(day.slots.at(-1)?.endTime, "21:00");
  assert.equal(day.slots[0].startIso, "2027-06-21T04:00:00.000Z");
});

test("daylightDay: Slots enden nie nach Sonnenuntergang", () => {
  for (const date of ["2026-12-21", "2027-03-28", "2027-10-31"]) {
    const day = daylightDay(date, LAT, LNG, 60);
    for (const s of day.slots) {
      assert.ok(s.startTime >= day.sunrise!, `${date} ${s.startTime} vor ${day.sunrise}`);
      assert.ok(s.endTime <= day.sunset!, `${date} ${s.endTime} nach ${day.sunset}`);
    }
  }
});

test("overlaps: halboffen, angrenzend ist frei", () => {
  assert.equal(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 }), false);
  assert.equal(overlaps({ start: 0, end: 10 }, { start: 9, end: 20 }), true);
  assert.equal(overlaps({ start: 5, end: 6 }, { start: 0, end: 20 }), true);
});

test("daylightSlotStates: eigene Buchung, vorbei, belegt, frei", () => {
  const day = daylightDay("2026-12-06", LAT, LNG, 60);
  const at = (hm: string) => new Date(`2026-12-06T${hm}:00+01:00`).getTime();
  const states = daylightSlotStates(day.slots, {
    now: new Date(at("10:30")),
    mine: [{ start: at("12:00"), end: at("13:00") }],
    // fremde 2-h-Buchung 13:30–15:30 belegt 13–14, 14–15 und 15–16
    busy: [{ start: at("12:00"), end: at("13:00") }, { start: at("13:30"), end: at("15:30") }],
  });
  const byStart = Object.fromEntries(states.map((s) => [s.startTime, s.state]));
  assert.equal(byStart["09:00"], "past");
  assert.equal(byStart["10:00"], "past");
  assert.equal(byStart["11:00"], "free");
  assert.equal(byStart["12:00"], "mine");
  assert.equal(byStart["13:00"], "taken");
  assert.equal(byStart["14:00"], "taken");
  assert.equal(byStart["15:00"], "taken");
});
