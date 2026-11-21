import { test } from "node:test";
import assert from "node:assert/strict";
import { beachLevel, normalizeBeachSettings, summarizeBeach } from "./beach-occupancy";

test("beachLevel: Vorgabe 600 / 1200 geschätzte Gäste", () => {
  assert.equal(beachLevel(0), "low");
  assert.equal(beachLevel(590), "low");
  assert.equal(beachLevel(600), "medium");
  assert.equal(beachLevel(1190), "medium");
  assert.equal(beachLevel(1200), "high");
});

test("summarizeBeach rechnet Eintritte mit Faktor hoch und bezieht den Balken auf die Kapazität", () => {
  const at = new Date("2026-06-26T12:00:00Z");
  const s = summarizeBeach(250, 3000, "Strandbad", at);
  assert.equal(s.estimated, 750);
  assert.equal(s.level, "medium");
  assert.equal(s.percent, 25);
  assert.equal(summarizeBeach(400, 3000, "Strandbad", at).level, "high");
  assert.equal(summarizeBeach(2000, 3000, "Strandbad", at).percent, 100);
  // ohne Kapazität: voll bei 1,4 × „Viel los“
  assert.equal(summarizeBeach(280, null, "Strandbad", at).percent, 50);
});

test("normalizeBeachSettings hält Werte in sinnvollen Grenzen", () => {
  assert.deepEqual(normalizeBeachSettings(null), { factor: 3, mediumFrom: 600, highFrom: 1200 });
  assert.deepEqual(normalizeBeachSettings({ factor: 0.2, mediumFrom: 800, highFrom: 500 }), { factor: 1, mediumFrom: 800, highFrom: 801 });
  assert.equal(normalizeBeachSettings({ factor: 2.55 }).factor, 2.6);
});
