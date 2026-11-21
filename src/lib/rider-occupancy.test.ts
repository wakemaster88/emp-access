import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeThresholds, occupancyLevel, summarizeOccupancy } from "./rider-occupancy";

test("occupancyLevel teilt nach Fahrern der letzten Stunde ein (Vorgabe 10 / 25)", () => {
  assert.equal(occupancyLevel(0), "none");
  assert.equal(occupancyLevel(1), "low");
  assert.equal(occupancyLevel(9), "low");
  assert.equal(occupancyLevel(10), "medium");
  assert.equal(occupancyLevel(24), "medium");
  assert.equal(occupancyLevel(25), "high");
});

test("occupancyLevel nutzt eingestellte Grenzen", () => {
  const t = { mediumFrom: 8, highFrom: 18 };
  assert.equal(occupancyLevel(7, t), "low");
  assert.equal(occupancyLevel(8, t), "medium");
  assert.equal(occupancyLevel(18, t), "high");
});

test("normalizeThresholds hält Viel los über Gut besucht", () => {
  assert.deepEqual(normalizeThresholds(null), { mediumFrom: 10, highFrom: 25 });
  assert.deepEqual(normalizeThresholds({ mediumFrom: 20, highFrom: 12 }), { mediumFrom: 20, highFrom: 21 });
  assert.deepEqual(normalizeThresholds({ mediumFrom: 0, highFrom: 1 }), { mediumFrom: 2, highFrom: 3 });
});

test("summarizeOccupancy zählt Fahrer einmal, Starts jeden Scan", () => {
  const at = new Date("2026-11-20T12:00:00Z");
  const s = summarizeOccupancy(
    [{ ticketId: 1 }, { ticketId: 1 }, { ticketId: 2 }, { ticketId: null, code: "X" }, { ticketId: null, code: null }],
    at,
  );
  assert.equal(s.riders, 3);
  assert.equal(s.starts, 5);
  assert.equal(s.level, "low");
  assert.equal(s.percent, 9); // 3 von 35
  assert.equal(summarizeOccupancy(Array.from({ length: 40 }, (_, i) => ({ ticketId: i })), at).percent, 100);
});
