import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVerdict, shouldInspect, type SentinelContext } from "./sentinel-rules.js";

const ev = { kind: "camera", title: "PERSON erkannt", where: "Eingang" };
const base: SentinelContext = {
  closed: null,
  hour: 12,
  nightWindow: "22-6",
  always: false,
  lastInspectAt: undefined,
  now: 1_000_000,
  cooldownMs: 180_000,
  inspectionsLastHour: 0,
  maxPerHour: 20,
};

test("Im Betrieb keine Bewertung, geschlossen schon", () => {
  assert.equal(shouldInspect(ev, { ...base, closed: false }), false);
  assert.equal(shouldInspect(ev, { ...base, closed: true }), true);
});

test("Ohne Betriebszeit entscheidet das Nachtfenster", () => {
  assert.equal(shouldInspect(ev, { ...base, hour: 12 }), false);
  assert.equal(shouldInspect(ev, { ...base, hour: 23 }), true);
});

test("Abstand je Kamera und Stundenlimit", () => {
  const night = { ...base, closed: true };
  assert.equal(shouldInspect(ev, { ...night, lastInspectAt: base.now - 60_000 }), false);
  assert.equal(shouldInspect(ev, { ...night, lastInspectAt: base.now - 200_000 }), true);
  assert.equal(shouldInspect(ev, { ...night, inspectionsLastHour: 20 }), false);
});

test("Nur Beginn von Personen/Fahrzeugen zaehlt", () => {
  const night = { ...base, closed: true };
  assert.equal(shouldInspect({ ...ev, title: "PERSON beendet" }, night), false);
  assert.equal(shouldInspect({ ...ev, title: "MOTION erkannt" }, night), false);
  assert.equal(shouldInspect({ ...ev, title: "VEHICLE erkannt" }, night), true);
  assert.equal(shouldInspect({ kind: "person", title: "Person unbekannt", where: "x" }, night), false);
});

test("Urteil lesen", () => {
  assert.deepEqual(parseVerdict('{"auffaellig": true, "was": "Person am Zaun", "dringlichkeit": "hoch"}'), {
    auffaellig: true,
    was: "Person am Zaun",
    dringlichkeit: "hoch",
  });
  assert.equal(parseVerdict("kaputt").auffaellig, false);
  assert.equal(parseVerdict('Antwort: {"auffaellig":"ja","was":"x"}').auffaellig, true);
});
