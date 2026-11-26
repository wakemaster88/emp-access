import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISCONNECTED_REPORT_MS,
  RECONNECT_IDLE_MS,
  RECONNECT_SLOW_MS,
  reconnectDelay,
  shouldReport,
} from "./soundweb-rules.js";

test("reconnectDelay: die ersten 10 Versuche wie bisher, 3 s verdoppelnd bis 60 s", () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => reconnectDelay(i + 1, true) / 1000),
    [3, 6, 12, 24, 48, 60, 60, 60, 60, 60]
  );
  // Unsinnige Zaehler zaehlen als erster Versuch.
  assert.equal(reconnectDelay(0, true), 3_000);
  assert.equal(reconnectDelay(-2, true), 3_000);
});

test("reconnectDelay: danach 5 min, ab einer Stunde Wartezeit 15 min", () => {
  assert.equal(reconnectDelay(11, true), RECONNECT_SLOW_MS);
  assert.equal(reconnectDelay(21, true), RECONNECT_SLOW_MS);
  assert.equal(reconnectDelay(22, true), RECONNECT_IDLE_MS);
  assert.equal(reconnectDelay(500, true), RECONNECT_IDLE_MS);
  // Die Wartezeit vor dem ersten 15-min-Abstand liegt bei einer Stunde.
  let waited = 0;
  for (let n = 1; n <= 21; n++) waited += reconnectDelay(n, true);
  assert.ok(waited >= 3_600_000 && waited < 3_600_000 + RECONNECT_SLOW_MS, `gewartet ${waited}`);
  let before = 0;
  for (let n = 1; n <= 20; n++) before += reconnectDelay(n, true);
  assert.ok(before < 3_600_000);
});

test("reconnectDelay: Geraet ohne Regler von Anfang an 15 min", () => {
  for (const n of [1, 2, 10, 11, 30]) assert.equal(reconnectDelay(n, false), RECONNECT_IDLE_MS);
});

test("reconnectDelay: zwei getrennte Geraete ohne Regler waehlen am Tag 96-mal statt 2.880-mal an", () => {
  let tries = 0;
  for (let t = 0, n = 1; t < 86_400_000; n++) {
    t += reconnectDelay(n, false);
    tries++;
  }
  assert.equal(2 * tries, 2 * 96);
});

const now = 10_000_000;

test("shouldReport: verbunden immer", () => {
  assert.equal(shouldReport({ connected: true, error: null, reported: { connected: true, error: null, at: now - 1 } }, now), true);
  assert.equal(shouldReport({ connected: true, error: null, reported: null }, now), true);
});

test("shouldReport: getrennt beim ersten Mal, nach einem Wechsel und als Lebenszeichen alle 10 min", () => {
  const err = "Verbindungsaufbau: Zeitüberschreitung";
  // Noch nie gemeldet.
  assert.equal(shouldReport({ connected: false, error: err, reported: null }, now), true);
  // Zuletzt als verbunden gemeldet: Wechsel.
  assert.equal(shouldReport({ connected: false, error: err, reported: { connected: true, error: null, at: now - 1_000 } }, now), true);
  // Anderer Fehlergrund: Wechsel.
  assert.equal(
    shouldReport({ connected: false, error: "Verbindung abgelehnt", reported: { connected: false, error: err, at: now - 1_000 } }, now),
    true
  );
  // Gleicher Stand: erst nach 10 min wieder.
  const same = (ago: number) => shouldReport({ connected: false, error: err, reported: { connected: false, error: err, at: now - ago } }, now);
  assert.equal(same(60_000), false);
  assert.equal(same(DISCONNECTED_REPORT_MS - 1), false);
  assert.equal(same(DISCONNECTED_REPORT_MS), true);
});

test("shouldReport: Minutentakt meldet ein dauerhaft getrenntes Geraet 144-mal am Tag statt 1.440-mal", () => {
  const err = "Verbindungsaufbau: Zeitüberschreitung";
  let reported: { connected: boolean; error: string | null; at: number } | null = null;
  let count = 0;
  for (let t = 0; t < 86_400_000; t += 60_000) {
    if (shouldReport({ connected: false, error: err, reported }, t)) {
      count++;
      reported = { connected: false, error: err, at: t };
    }
  }
  assert.equal(count, 144);
});
