import { test } from "node:test";
import assert from "node:assert/strict";
import { debounceEvents, newDebounceState } from "./event-debounce.js";

const HOLD = 6000;

test("Flackern innerhalb der Nachlaufzeit erzeugt kein neues Ereignis", () => {
  const st = newDebounceState();
  assert.deepEqual(debounceEvents(st, { PERSON: true }, 0, HOLD), [
    { type: "PERSON", phase: "start", at: 0 },
  ]);
  assert.deepEqual(debounceEvents(st, { PERSON: false }, 2000, HOLD), []);
  assert.deepEqual(debounceEvents(st, { PERSON: true }, 4000, HOLD), []);
  assert.deepEqual(debounceEvents(st, { PERSON: false }, 6000, HOLD), []);
  assert.deepEqual(debounceEvents(st, { PERSON: false }, 10000, HOLD), [
    { type: "PERSON", phase: "end", at: 4000 },
  ]);
  assert.deepEqual(debounceEvents(st, { PERSON: true }, 12000, HOLD), [
    { type: "PERSON", phase: "start", at: 12000 },
  ]);
});

test("Fehlende Typen (KI-Abfrage fehlgeschlagen) beenden nichts", () => {
  const st = newDebounceState();
  debounceEvents(st, { MOTION: true, VEHICLE: true }, 0, HOLD);
  assert.deepEqual(debounceEvents(st, { MOTION: false }, 20000, HOLD), [
    { type: "MOTION", phase: "end", at: 0 },
  ]);
  assert.equal(st.reported.VEHICLE, true);
});

test("Ohne Nachlauf (0 ms) verhält es sich wie vorher", () => {
  const st = newDebounceState();
  debounceEvents(st, { MOTION: true }, 0, 0);
  assert.deepEqual(debounceEvents(st, { MOTION: false }, 2000, 0), [
    { type: "MOTION", phase: "end", at: 0 },
  ]);
});
