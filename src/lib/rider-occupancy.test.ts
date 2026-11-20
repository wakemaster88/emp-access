import { test } from "node:test";
import assert from "node:assert/strict";
import { occupancyLevel, summarizeOccupancy } from "./rider-occupancy";

test("occupancyLevel teilt nach Fahrern der letzten Stunde ein", () => {
  assert.equal(occupancyLevel(0), "none");
  assert.equal(occupancyLevel(1), "low");
  assert.equal(occupancyLevel(5), "low");
  assert.equal(occupancyLevel(6), "medium");
  assert.equal(occupancyLevel(14), "medium");
  assert.equal(occupancyLevel(15), "high");
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
  assert.equal(s.percent, 12);
  assert.equal(summarizeOccupancy(Array.from({ length: 40 }, (_, i) => ({ ticketId: i })), at).percent, 100);
});
