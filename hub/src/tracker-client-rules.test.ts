import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BREAKER_FAILS,
  BREAKER_OFF_MS,
  DEFAULT_TRACKER_TIMEOUT_MS,
  MAX_IMGSZ,
  breakerStep,
  classifyQuery,
  newBreaker,
  trackerDown,
  trackerTimeoutMs,
  type BreakerEvent,
  type BreakerState,
} from "./tracker-client-rules.js";

/** Ereignisse nacheinander anwenden; liefert Zustand und Zustandswechsel. */
function run(events: Array<[BreakerEvent, number]>, start: BreakerState = newBreaker()) {
  let state = start;
  const changes: Array<[number, "down" | "up"]> = [];
  const allowed: boolean[] = [];
  for (const [event, at] of events) {
    const step = breakerStep(state, event, at);
    state = step.state;
    if (step.change) changes.push([at, step.change]);
    if (event === "ask") allowed.push(step.allow);
  }
  return { state, changes, allowed };
}

test("Standard: nach 2 Fehlern in Folge 30 s aus", () => {
  assert.equal(BREAKER_FAILS, 2);
  assert.equal(BREAKER_OFF_MS, 30_000);
});

test("ein einzelner Fehler sperrt nicht, ein Erfolg setzt die Fehlerzahl zurück", () => {
  const r = run([
    ["fail", 0],
    ["ask", 1],
    ["ok", 2],
    ["fail", 3],
    ["ask", 4],
  ]);
  assert.deepEqual(r.allowed, [true, true]);
  assert.deepEqual(r.changes, []);
  assert.equal(r.state.fails, 1);
  assert.equal(r.state.down, false);
});

test("zwei Fehler in Folge: 30 s lang kein Aufruf, genau ein Zustandswechsel", () => {
  const r = run([
    ["fail", 1_000],
    ["fail", 2_000],
    ["ask", 2_001],
    ["ask", 31_999],
    ["ask", 32_000],
  ]);
  assert.deepEqual(r.allowed, [false, false, true]);
  assert.deepEqual(r.changes, [[2_000, "down"]]);
  assert.equal(r.state.offUntil, 32_000);
});

test("nach der Sperre: Erfolg = wieder an (ein Wechsel), Fehler = weitere 30 s ohne neuen Wechsel", () => {
  const down = run([
    ["fail", 0],
    ["fail", 0],
  ]).state;
  const back = run([["ask", 30_000], ["ok", 30_050], ["ask", 30_051]], down);
  assert.deepEqual(back.changes, [[30_050, "up"]]);
  assert.deepEqual(back.allowed, [true, true]);
  assert.deepEqual(back.state, newBreaker());

  const still = run([["ask", 30_000], ["fail", 36_000], ["ask", 36_001], ["ask", 66_000]], down);
  assert.deepEqual(still.changes, []);
  assert.deepEqual(still.allowed, [true, false, true]);
  assert.equal(still.state.down, true);
});

test("Aufrufe, die schon unterwegs waren, zählen mit: ein später Erfolg beendet die Sperre", () => {
  const down = run([
    ["fail", 0],
    ["fail", 10],
  ]).state;
  const r = run([["ok", 500], ["ask", 501]], down);
  assert.deepEqual(r.changes, [[500, "up"]]);
  assert.deepEqual(r.allowed, [true]);
});

test("eigene Einstellung: 3 Fehler, 10 s", () => {
  let s = newBreaker();
  const cfg = { fails: 3, offMs: 10_000 };
  s = breakerStep(s, "fail", 0, cfg).state;
  s = breakerStep(s, "fail", 0, cfg).state;
  assert.equal(breakerStep(s, "ask", 1, cfg).allow, true);
  const third = breakerStep(s, "fail", 1, cfg);
  assert.equal(third.change, "down");
  assert.equal(breakerStep(third.state, "ask", 10_000, cfg).allow, false);
  assert.equal(breakerStep(third.state, "ask", 10_001, cfg).allow, true);
});

test("Ausfall: keine Antwort, Serverfehler, PIN abgelehnt, Route fehlt – nicht: ein unbrauchbares Bild", () => {
  assert.equal(trackerDown(null), true);
  assert.equal(trackerDown(500), true);
  assert.equal(trackerDown(503), true);
  assert.equal(trackerDown(401), true);
  assert.equal(trackerDown(403), true);
  assert.equal(trackerDown(404), true);
  assert.equal(trackerDown(400), false);
  assert.equal(trackerDown(413), false);
  assert.equal(trackerDown(200), false);
});

test("Zeitlimit: Standard 6 s, sonst die Angabe in ms", () => {
  assert.equal(DEFAULT_TRACKER_TIMEOUT_MS, 6_000);
  assert.equal(trackerTimeoutMs(undefined), 6_000);
  assert.equal(trackerTimeoutMs(""), 6_000);
  assert.equal(trackerTimeoutMs("abc"), 6_000);
  assert.equal(trackerTimeoutMs("0"), 6_000);
  assert.equal(trackerTimeoutMs("-5"), 6_000);
  assert.equal(trackerTimeoutMs("5000"), 5_000);
});

test("Query: ohne Angaben leer – der Tracker rechnet wie bisher", () => {
  assert.equal(classifyQuery({}), "");
  assert.equal(classifyQuery({ roi: null, imgsz: null }), "");
});

test("Query: Ausschnitt normiert mit vier Stellen, auf das Bild begrenzt", () => {
  assert.equal(classifyQuery({ roi: { x: 0.5, y: 0.1, w: 0.3, h: 0.4 } }), "?roi=0.5000%2C0.1000%2C0.3000%2C0.4000");
  const q = new URLSearchParams(classifyQuery({ roi: { x: -0.1, y: 0.8, w: 0.5, h: 0.5 } }).slice(1));
  assert.equal(q.get("roi"), "0.0000,0.8000,0.4000,0.2000");
  assert.equal(classifyQuery({ roi: { x: 1.2, y: 0, w: 0.3, h: 0.3 } }), "");
  assert.equal(classifyQuery({ roi: { x: 0.2, y: 0.2, w: 0, h: 0.3 } }), "");
  assert.equal(classifyQuery({ roi: { x: Number.NaN, y: 0, w: 0.3, h: 0.3 } }), "");
});

test("Query: imgsz als Vielfaches von 32, höchstens 1280", () => {
  assert.equal(MAX_IMGSZ, 1280);
  assert.equal(classifyQuery({ imgsz: 1280 }), "?imgsz=1280");
  assert.equal(classifyQuery({ imgsz: 4000 }), "?imgsz=1280");
  assert.equal(classifyQuery({ imgsz: 1000 }), "?imgsz=992");
  assert.equal(classifyQuery({ imgsz: 10 }), "?imgsz=32");
  assert.equal(classifyQuery({ imgsz: 0 }), "");
  const q = new URLSearchParams(classifyQuery({ roi: { x: 0.4, y: 0.1, w: 0.5, h: 0.6 }, imgsz: 1280 }).slice(1));
  assert.equal(q.get("imgsz"), "1280");
  assert.equal(q.get("roi"), "0.4000,0.1000,0.5000,0.6000");
});
