import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateSamples, bucketOf, plausible } from "./climate-buckets.js";

const T0 = Date.parse("2026-11-05T10:15:00Z");

test("bucketOf rundet auf fuenf Minuten ab", () => {
  assert.equal(bucketOf(T0 + 4 * 60_000 + 59_000), T0);
  assert.equal(bucketOf(T0 + 5 * 60_000), T0 + 5 * 60_000);
});

test("aggregateSamples bildet Min, Mittel, Max je Geraet und Fenster", () => {
  const out = aggregateSamples([
    { deviceId: 7, at: T0 + 10_000, tC: 19.8, rh: 58 },
    { deviceId: 7, at: T0 + 70_000, tC: 20.2, rh: null },
    { deviceId: 7, at: T0 + 130_000, tC: 20, rh: 60 },
    { deviceId: 7, at: T0 + 5 * 60_000, tC: 21, rh: 61 },
    { deviceId: 9, at: T0 + 20_000, tC: null, rh: null },
  ]);
  assert.deepEqual(out, [
    {
      deviceId: 7,
      bucketStart: "2026-11-05T10:15:00.000Z",
      tempMin: 19.8,
      tempAvg: 20,
      tempMax: 20.2,
      humMin: 58,
      humAvg: 59,
      humMax: 60,
      count: 3,
    },
    {
      deviceId: 7,
      bucketStart: "2026-11-05T10:20:00.000Z",
      tempMin: 21,
      tempAvg: 21,
      tempMax: 21,
      humMin: 61,
      humAvg: 61,
      humMax: 61,
      count: 1,
    },
  ]);
});

test("plausible verwirft Unsinn und rundet", () => {
  assert.deepEqual(plausible(19.876, 58.44), { tC: 19.88, rh: 58.44 });
  assert.deepEqual(plausible(999, -3), { tC: null, rh: null });
  assert.deepEqual(plausible(null, 50), { tC: null, rh: 50 });
});
