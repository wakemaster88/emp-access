import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAreaRates } from "./turnstile-rate";

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
