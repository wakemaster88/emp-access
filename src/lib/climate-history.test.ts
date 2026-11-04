import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketStart, mergeStats, parseHubSample, RANGE_SPEC } from "./climate-history";

const NOW = Date.parse("2026-11-05T10:17:30Z");

test("bucketStart rundet auf das Fenster ab", () => {
  assert.equal(new Date(bucketStart(NOW, "MIN5")).toISOString(), "2026-11-05T10:15:00.000Z");
  assert.equal(new Date(bucketStart(NOW, "HOUR")).toISOString(), "2026-11-05T10:00:00.000Z");
  assert.equal(new Date(bucketStart(NOW, "DAY")).toISOString(), "2026-11-05T00:00:00.000Z");
});

test("mergeStats gewichtet nach count und haelt Min/Max", () => {
  const merged = mergeStats([
    { tempMin: 18, tempAvg: 19, tempMax: 20, humMin: 50, humAvg: 55, humMax: 60, count: 1 },
    { tempMin: 21, tempAvg: 22, tempMax: 23, humMin: null, humAvg: null, humMax: null, count: 3 },
  ]);
  assert.deepEqual(merged, { tempMin: 18, tempAvg: 21.25, tempMax: 23, humMin: 50, humAvg: 55, humMax: 60, count: 4 });
  assert.equal(mergeStats([]), null);
});

test("parseHubSample prueft Kennung, Zeit und Wertebereich", () => {
  const ok = parseHubSample({ deviceId: 7, bucketStart: "2026-11-05T10:17:00Z", tempAvg: 19.84, humAvg: 58 }, NOW);
  assert.ok(ok);
  assert.equal(ok.bucketStart.toISOString(), "2026-11-05T10:15:00.000Z");
  assert.equal(ok.tempMin, 19.84);
  assert.equal(ok.count, 1);
  assert.equal(parseHubSample({ deviceId: 7, bucketStart: "2026-11-05T12:00:00Z", tempAvg: 19 }, NOW), null, "Zukunft");
  assert.equal(parseHubSample({ deviceId: 7, bucketStart: "2026-11-05T10:15:00Z", tempAvg: 250 }, NOW), null, "Unsinn");
  assert.equal(parseHubSample({ deviceId: "x", bucketStart: "2026-11-05T10:15:00Z", tempAvg: 19 }, NOW), null);
});

test("Anzeigefenster bleiben unter 400 Punkten je Zeitraum", () => {
  for (const spec of Object.values(RANGE_SPEC)) assert.ok(spec.spanMs / spec.bucketMs <= 400);
});
