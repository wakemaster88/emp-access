import { test } from "node:test";
import assert from "node:assert/strict";
import { berlinWall, clockOffsetSeconds } from "./camera-clock.js";

test("Berliner Wanduhr im Winter (UTC+1)", () => {
  assert.deepEqual(berlinWall(new Date("2026-11-05T13:00:00Z")), { year: 2026, mon: 11, day: 5, hour: 14, min: 0, sec: 0 });
});

test("Kamera geht 42 s vor", () => {
  const now = new Date("2026-11-05T13:00:00Z");
  assert.equal(clockOffsetSeconds({ year: 2026, mon: 11, day: 5, hour: 14, min: 0, sec: 42 }, now), 42);
});

test("falsche Sommerzeit fällt als -3600 s auf", () => {
  const now = new Date("2026-11-05T13:00:00Z");
  assert.equal(clockOffsetSeconds({ year: 2026, mon: 11, day: 5, hour: 13, min: 0, sec: 0 }, now), -3600);
});
