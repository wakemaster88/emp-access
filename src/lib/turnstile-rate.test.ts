import { test } from "node:test";
import assert from "node:assert/strict";
import { countRateScans, scanTotalsFromCounts, summarizeAreaRateCounts, summarizeAreaRates } from "./turnstile-rate";

const now = new Date("2026-07-12T14:00:00Z");
const dayStart = new Date("2026-07-11T22:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

test("Seilbahn A: Eintritte je Zeitfenster, kein Ausgang", () => {
  const [a] = summarizeAreaRates(
    [{ id: 5, name: "Seilbahn A", personLimit: 100 }],
    [{ id: 84, accessIn: 5, accessOut: null }],
    [
      { deviceId: 84, scanTime: ago(5), result: "GRANTED" },
      { deviceId: 84, scanTime: ago(10), result: "DENIED" },
      { deviceId: 84, scanTime: ago(30), result: "GRANTED" },
      { deviceId: 84, scanTime: ago(200), result: "GRANTED" },
      { deviceId: 84, scanTime: new Date("2026-07-11T20:00:00Z"), result: "GRANTED" },
    ],
    now,
    dayStart,
  );
  assert.equal(a.in15, 1);
  assert.equal(a.in60, 2);
  assert.equal(a.inToday, 3);
  assert.equal(a.denied15, 1);
  assert.equal(a.out15, null);
  assert.equal(a.inside, null);
  assert.equal(a.lastScanAt, ago(5).toISOString());
});

test("Strandbad: getrennte Ein- und Ausgaenge ergeben Anwesende", () => {
  const [s] = summarizeAreaRates(
    [{ id: 8, name: "Strandbad", personLimit: 3000 }],
    [
      { id: 49, accessIn: 8, accessOut: null },
      { id: 50, accessIn: null, accessOut: 8 },
    ],
    [
      { deviceId: 49, scanTime: ago(5), result: "GRANTED" },
      { deviceId: 49, scanTime: ago(6), result: "GRANTED" },
      { deviceId: 49, scanTime: ago(90), result: "GRANTED" },
      { deviceId: 50, scanTime: ago(3), result: "GRANTED" },
    ],
    now,
    dayStart,
  );
  assert.equal(s.inside, 2);
  assert.equal(s.out15, 1);
});

test("Bereiche ohne Drehkreuz fallen weg", () => {
  assert.deepEqual(summarizeAreaRates([{ id: 1, name: "Insel", personLimit: null }], [], [], now, dayStart), []);
});

// ─── Gezaehlte Scans (Datenbank-Zaehlung) ───────────────────────────────────

/** Einfacher, reproduzierbarer Zufall fuer die Vergleichstests. */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function randomScans(seed: number, n: number) {
  const r = rng(seed);
  const results = ["GRANTED", "GRANTED", "GRANTED", "DENIED", "PROTECTED"];
  return Array.from({ length: n }, () => ({
    deviceId: r() < 0.05 ? null : [84, 49, 50, 51, 99][Math.floor(r() * 5)],
    result: results[Math.floor(r() * results.length)],
    // Vom Vortag bis kurz nach `now` (Uhrzeit des Geraets kann vorgehen).
    scanTime: new Date(dayStart.getTime() - 3 * 3_600_000 + Math.floor(r() * 20 * 3_600_000)),
  }));
}

const rateAreas = [
  { id: 5, name: "Seilbahn A", personLimit: 100 },
  { id: 8, name: "Strandbad", personLimit: 3000 },
  { id: 9, name: "Ohne Geraet", personLimit: null },
];
const rateDevices = [
  { id: 84, accessIn: 5, accessOut: null },
  { id: 49, accessIn: 8, accessOut: null },
  { id: 50, accessIn: null, accessOut: 8 },
  { id: 51, accessIn: 8, accessOut: 8 },
];

test("summarizeAreaRateCounts liefert dasselbe wie summarizeAreaRates", () => {
  for (const seed of [1, 7, 42, 1234]) {
    const scans = randomScans(seed, 800);
    const expected = summarizeAreaRates(rateAreas, rateDevices, scans, now, dayStart);
    const actual = summarizeAreaRateCounts(rateAreas, rateDevices, countRateScans(scans, now, dayStart));
    assert.deepEqual(actual, expected);
  }
});

test("summarizeAreaRateCounts: Scans nach now zaehlen nicht, letzter Scan bis now", () => {
  const scans = [
    { deviceId: 84, scanTime: ago(2), result: "GRANTED" },
    { deviceId: 84, scanTime: new Date(now.getTime() + 60_000), result: "GRANTED" },
    { deviceId: 84, scanTime: now, result: "DENIED" },
  ];
  const [a] = summarizeAreaRateCounts(rateAreas, rateDevices, countRateScans(scans, now, dayStart));
  assert.equal(a.inToday, 1);
  assert.equal(a.denied15, 1);
  assert.equal(a.lastScanAt, now.toISOString());
});

test("scanTotalsFromCounts zaehlt wie die Live-Lage (ab Tagesbeginn, ohne Obergrenze)", () => {
  for (const seed of [3, 99]) {
    const scans = randomScans(seed, 500);
    const t15 = now.getTime() - 15 * 60_000;
    const t60 = now.getTime() - 60 * 60_000;
    const expected = { in15: 0, in60: 0, inToday: 0, denied15: 0, denied60: 0, deniedToday: 0 };
    for (const s of scans) {
      const t = s.scanTime.getTime();
      if (t < dayStart.getTime()) continue;
      if (s.result === "GRANTED") {
        expected.inToday++;
        if (t >= t60) expected.in60++;
        if (t >= t15) expected.in15++;
      } else if (s.result === "DENIED") {
        expected.deniedToday++;
        if (t >= t60) expected.denied60++;
        if (t >= t15) expected.denied15++;
      }
    }
    assert.deepEqual(scanTotalsFromCounts(countRateScans(scans, now, dayStart)), expected);
  }
});
