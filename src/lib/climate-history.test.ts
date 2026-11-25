import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketStart, mergeStats, parseHubSample, RANGE_SPEC, statsFromSums, type BucketSums, type SampleStats } from "./climate-history";

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

/** Summen so bilden, wie es die SQL-Abfrage fuer Monat und Jahr tut. */
function sumsOf(list: SampleStats[]) {
  const w = (s: SampleStats) => Math.max(1, s.count);
  const t = list.filter((s) => s.tempAvg != null);
  const h = list.filter((s) => s.humAvg != null);
  const minN = (v: number[]) => (v.length ? Math.min(...v) : null);
  const maxN = (v: number[]) => (v.length ? Math.max(...v) : null);
  return {
    tempMin: minN(t.map((s) => s.tempMin ?? s.tempAvg!)),
    tempMax: maxN(t.map((s) => s.tempMax ?? s.tempAvg!)),
    tempSum: t.length ? t.reduce((a, s) => a + s.tempAvg! * w(s), 0) : null,
    tempW: t.length ? t.reduce((a, s) => a + w(s), 0) : null,
    humMin: minN(h.map((s) => s.humMin ?? s.humAvg!)),
    humMax: maxN(h.map((s) => s.humMax ?? s.humAvg!)),
    humSum: h.length ? h.reduce((a, s) => a + s.humAvg! * w(s), 0) : null,
    humW: h.length ? h.reduce((a, s) => a + w(s), 0) : null,
    count: list.reduce((a, s) => a + w(s), 0),
  };
}

test("statsFromSums rechnet wie mergeStats (Gewicht, Rundung, fehlende Werte)", () => {
  const cases: SampleStats[][] = [
    [
      { tempMin: 18, tempAvg: 19, tempMax: 20, humMin: 50, humAvg: 55, humMax: 60, count: 1 },
      { tempMin: 21, tempAvg: 22, tempMax: 23, humMin: null, humAvg: null, humMax: null, count: 3 },
    ],
    [
      { tempMin: null, tempAvg: 19.333, tempMax: null, humMin: 40, humAvg: 41.117, humMax: 42, count: 0 },
      { tempMin: 17.2, tempAvg: 18.871, tempMax: 19.9, humMin: null, humAvg: 47.5, humMax: null, count: 7 },
      { tempMin: 5, tempAvg: null, tempMax: 50, humMin: 10, humAvg: 12.004, humMax: 15, count: 12 },
    ],
    [{ tempMin: null, tempAvg: null, tempMax: null, humMin: null, humAvg: 60.125, humMax: null, count: 2 }],
  ];
  for (const list of cases) assert.deepEqual(statsFromSums(sumsOf(list)), mergeStats(list));
});

test("statsFromSums nimmt Zahlen auch als Text an, wie ein Treiber sie liefern kann", () => {
  const list: SampleStats[] = [
    { tempMin: 17.2, tempAvg: 18.871, tempMax: 19.9, humMin: null, humAvg: 47.5, humMax: null, count: 7 },
    { tempMin: 5, tempAvg: null, tempMax: 50, humMin: 10, humAvg: 12.004, humMax: 15, count: 12 },
  ];
  const sums = sumsOf(list);
  const asText = Object.fromEntries(
    Object.entries(sums).map(([k, v]) => [k, v == null ? v : String(v)]),
  ) as unknown as BucketSums;
  const stats = statsFromSums(asText);
  assert.deepEqual(stats, mergeStats(list));
  assert.equal(typeof stats.tempMin, "number");
  assert.equal(typeof stats.count, "number");
});
