import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_BRIGHTNESS,
  LEGACY_MODE,
  ledModeNote,
  legacyWhiteLedParam,
  reportedLedMode,
  spotlightCommand,
  spotlightLegacy,
  whiteLedParam,
} from "./spotlight-rules.js";

/** Antwort auf GetWhiteLed (Feld WhiteLed), wie eine RLC-811A sie liefert. */
const cur = (o: Record<string, unknown> = {}) => ({
  channel: 0,
  state: 0,
  mode: 0,
  bright: 60,
  LightingSchedule: { StartHour: 18, StartMin: 0, EndHour: 6, EndMin: 0 },
  wlAiDetectType: { people: 1, vehicle: 1, dog_cat: 0, face: 0 },
  ...o,
});

test("Einschalten ändert nur state: Lichtmodus und Helligkeit bleiben, wie die Kamera sie meldet", () => {
  assert.deepEqual(whiteLedParam(cur(), true), { state: 1, mode: 0, bright: 60 });
  assert.deepEqual(whiteLedParam(cur({ mode: 3, bright: 35 }), true), { state: 1, mode: 3, bright: 35 });
});

test("Ausschalten ändert nur state, auch mit angegebener Helligkeit", () => {
  assert.deepEqual(whiteLedParam(cur({ state: 1, mode: 1 }), false), { state: 0, mode: 1, bright: 60 });
  assert.deepEqual(whiteLedParam(cur({ state: 1, mode: 1 }), false, 100), { state: 0, mode: 1, bright: 60 });
});

test("Helligkeit nur beim Einschalten und nur, wenn der Aufrufer sie ausdrücklich angibt", () => {
  assert.deepEqual(whiteLedParam(cur(), true, 100), { state: 1, mode: 0, bright: 100 });
  assert.deepEqual(whiteLedParam(cur(), true, 250), { state: 1, mode: 0, bright: 100 });
  assert.deepEqual(whiteLedParam(cur(), true, 0.2), { state: 1, mode: 0, bright: 1 });
  assert.deepEqual(whiteLedParam(cur(), true, Number.NaN), { state: 1, mode: 0, bright: 60 });
  assert.deepEqual(whiteLedParam(cur(), true, undefined), { state: 1, mode: 0, bright: 60 });
});

test("Zeitplan, Erkennungsarten und unbekannte Felder stehen nicht im Befehl", () => {
  const p = whiteLedParam(cur({ extra: "x" }), true) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(p).sort(), ["bright", "mode", "state"]);
});

test("Meldet die Kamera keine Helligkeit, fehlt bright im Befehl", () => {
  const { bright: _bright, ...noBright } = cur();
  assert.deepEqual(whiteLedParam(noBright, true), { state: 1, mode: 0 });
  assert.deepEqual(whiteLedParam(cur({ bright: "60" }), false), { state: 0, mode: 0 });
  assert.deepEqual(whiteLedParam(cur({ bright: 140 }), false), { state: 0, mode: 0 });
});

test("kein brauchbarer Stand: keine Antwort, state nicht 0/1, mode keine ganze Zahl", () => {
  for (const bad of [
    null,
    undefined,
    "WhiteLed",
    [],
    {},
    cur({ state: undefined }),
    cur({ state: 2 }),
    cur({ state: "1" }),
    cur({ mode: undefined }),
    cur({ mode: "1" }),
    cur({ mode: 1.5 }),
    cur({ mode: -1 }),
  ]) {
    assert.equal(whiteLedParam(bad, true), null, JSON.stringify(bad));
  }
});

test("früherer Befehl: Lichtmodus 1 und Helligkeit 100 oder die angegebene, auch beim Ausschalten", () => {
  assert.equal(LEGACY_MODE, 1);
  assert.equal(LEGACY_BRIGHTNESS, 100);
  assert.deepEqual(legacyWhiteLedParam(true), { state: 1, mode: 1, bright: 100 });
  assert.deepEqual(legacyWhiteLedParam(false), { state: 0, mode: 1, bright: 100 });
  assert.deepEqual(legacyWhiteLedParam(true, 40), { state: 1, mode: 1, bright: 40 });
  assert.deepEqual(legacyWhiteLedParam(false, 40), { state: 0, mode: 1, bright: 40 });
});

test("HUB_SPOTLIGHT_LEGACY: 1, true, ja, on schalten den früheren Befehl ein, alles andere nicht", () => {
  for (const on of ["1", "true", "TRUE", "ja", "Ja", "on", "yes", " 1 "]) {
    assert.equal(spotlightLegacy(on), true, on);
  }
  for (const off of [undefined, "", " ", "0", "false", "nein", "off", "2"]) {
    assert.equal(spotlightLegacy(off), false, String(off));
  }
});

test("Befehl: Standard behält den Stand der Kamera, ohne brauchbaren Stand der frühere Befehl", () => {
  assert.deepEqual(spotlightCommand({ legacy: false, current: cur({ mode: 3 }), on: true }), {
    param: { state: 1, mode: 3, bright: 60 },
    how: "keep",
  });
  assert.deepEqual(spotlightCommand({ legacy: false, current: null, on: true }), {
    param: { state: 1, mode: 1, bright: 100 },
    how: "fallback",
  });
  assert.deepEqual(spotlightCommand({ legacy: false, current: { state: 0 }, on: false, brightness: 70 }), {
    param: { state: 0, mode: 1, bright: 70 },
    how: "fallback",
  });
});

test("Befehl: mit Rückschalter immer der frühere, auch wenn die Kamera ihren Stand meldet", () => {
  assert.deepEqual(spotlightCommand({ legacy: true, current: cur({ mode: 0, bright: 30 }), on: true }), {
    param: { state: 1, mode: 1, bright: 100 },
    how: "legacy",
  });
  assert.deepEqual(spotlightCommand({ legacy: true, current: cur(), on: false, brightness: 55 }), {
    param: { state: 0, mode: 1, bright: 55 },
    how: "legacy",
  });
});

test("Lichtmodus fürs Log: nur, wenn die Kamera ihn gemeldet hat", () => {
  assert.equal(reportedLedMode(cur({ mode: 1 })), 1);
  assert.equal(reportedLedMode(null), null);
  assert.equal(ledModeNote(cur({ mode: 0 })), "Lichtmodus laut Kamera mode=0");
  assert.equal(ledModeNote({ state: 1 }), "");
  assert.equal(ledModeNote(null), "");
  assert.equal(ledModeNote(undefined), "");
});
