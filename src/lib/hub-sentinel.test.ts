import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HUB_SENTINEL_LOG_TAG,
  SENTINEL_REPORT_MAX_AGE_MS,
  coveringHub,
  mutedLine,
  parseSentinelReport,
  sentinelCovers,
  sentinelVouched,
  storedSentinelReport,
} from "./hub-sentinel";

const now = new Date("2026-11-23T22:04:05.000Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const covers = (report: Parameters<typeof sentinelCovers>[0]["report"], cameraId = 8) =>
  sentinelCovers({ cameraId, report, now, maxAgeMs: SENTINEL_REPORT_MAX_AGE_MS });

test("sentinelCovers: frisch und genannt ja", () => {
  assert.equal(SENTINEL_REPORT_MAX_AGE_MS, 2 * 60_000);
  assert.equal(covers({ at: minutesAgo(1), cameras: [3, 8, 9] }), true);
  assert.equal(covers({ at: minutesAgo(1.5), cameras: [8] }), true, "ein Lebenszeichen je Minute, Takt 30 s alt");
  assert.equal(covers({ at: minutesAgo(2), cameras: [8] }), true, "genau 2 Minuten");
});

test("sentinelCovers: älter als 2 Minuten nein", () => {
  assert.equal(covers({ at: new Date(now.getTime() - SENTINEL_REPORT_MAX_AGE_MS - 1).toISOString(), cameras: [8] }), false);
  assert.equal(covers({ at: minutesAgo(3), cameras: [8] }), false);
  assert.equal(covers({ at: minutesAgo(5), cameras: [8] }), false, "früher noch gültig");
});

test("sentinelCovers: Kamera fehlt nein", () => {
  assert.equal(covers({ at: minutesAgo(1), cameras: [3, 9] }), false);
  assert.equal(covers({ at: minutesAgo(1), cameras: [] }), false);
});

test("sentinelCovers: kein Bericht nein", () => {
  assert.equal(covers(null), false);
  assert.equal(covers(undefined), false);
  assert.equal(covers({ at: "kaputt", cameras: [8] }), false);
  // Aus der Zukunft (Uhr falsch): zählt nicht.
  assert.equal(covers({ at: minutesAgo(-2), cameras: [8] }), false);
});

test("parseSentinelReport: Zeitpunkt höchstens der Empfang, Kameras bereinigt", () => {
  const r = parseSentinelReport({ at: minutesAgo(-3), cameras: [9, "8", 8, -1, 2.5, "x"] }, now);
  assert.deepEqual(r, { at: now.toISOString(), cameras: [8, 9] });
  assert.deepEqual(parseSentinelReport({ at: minutesAgo(1), cameras: [8] }, now), { at: minutesAgo(1), cameras: [8] });
});

test("parseSentinelReport: fehlendes Feld bleibt aus, unlesbares gilt als Meldung ohne Kamera", () => {
  assert.equal(parseSentinelReport(undefined, now), null);
  assert.equal(parseSentinelReport(null, now), null);
  assert.deepEqual(parseSentinelReport("ja", now), { at: now.toISOString(), cameras: [] });
  assert.deepEqual(parseSentinelReport({ cameras: "8" }, now), { at: now.toISOString(), cameras: [] });
});

test("storedSentinelReport liest HubAgent.status.sentinel", () => {
  assert.deepEqual(storedSentinelReport({ parking: {}, sentinel: { at: minutesAgo(1), cameras: [8] } }), {
    at: minutesAgo(1),
    cameras: [8],
  });
  assert.equal(storedSentinelReport(null), null);
  assert.equal(storedSentinelReport({ parking: {} }), null);
  assert.equal(storedSentinelReport({ sentinel: { cameras: [8] } }), null);
  assert.equal(storedSentinelReport([1]), null);
});

test("coveringHub: der erste Hub mit frischer Meldung zur Kamera", () => {
  const hubs = [
    { name: "alt", status: { sentinel: { at: minutesAgo(10), cameras: [8] } } },
    { name: "ohne", status: { system: {} } },
    { name: "hub", status: { sentinel: { at: minutesAgo(1), cameras: [8, 9] } } },
  ];
  const hit = coveringHub(hubs, 8, now);
  assert.equal(hit?.hub.name, "hub");
  assert.equal(hit?.ageMs, 60_000);
  assert.equal(coveringHub(hubs, 3, now), null);
  assert.equal(coveringHub([], 8, now), null);
});

test("sentinelVouched: nur genau „1“ ist ein Beleg; ohne Parameter (älterer Hub) meldet die Cloud selbst", () => {
  assert.equal(sentinelVouched("1"), true);
  for (const raw of [null, undefined, "", "0", "true", "ja", " 1", "1 ", "01", "2"]) {
    assert.equal(sentinelVouched(raw), false, String(raw));
  }
  assert.equal(sentinelVouched(new URLSearchParams("cameraId=8").get("sentinel")), false);
  assert.equal(sentinelVouched(new URLSearchParams("cameraId=8&sentinel=1").get("sentinel")), true);
});

test("mutedLine: festes Kürzel, Kamera, Grund und Nummer", () => {
  const line = mutedLine({ accountId: 1, cameraId: 8, channel: "Telegram", hubName: "hub", ageMs: 42_400, count: 17 });
  assert.ok(line.startsWith(HUB_SENTINEL_LOG_TAG));
  assert.match(line, /account=1 Kamera 8: Telegram zu unbekannter Person nicht gesendet/);
  assert.match(line, /Wächter des Hubs „hub“ bewacht die Kamera \(Meldung vor 42 s\), Nr\. 17$/);
  assert.doesNotMatch(mutedLine({ accountId: 1, cameraId: 8, channel: "Push", hubName: "hub", ageMs: 0, count: null }), /Nr\./);
});
