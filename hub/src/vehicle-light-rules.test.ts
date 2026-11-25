import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIGHT_MARK_MAX_AGE_MS,
  burstSwitchesLight,
  isDark,
  lightMarkStep,
  spotlightWanted,
} from "./vehicle-light-rules.js";

// 14.11.2026 Beckum: Aufgang ca. 07:50, Untergang ca. 16:35 Berlin.
const DAYS = [
  { sunrise: "2026-11-14T06:50:00Z", sunset: "2026-11-14T15:35:00Z" },
  { sunrise: "2026-11-15T06:52:00Z", sunset: "2026-11-15T15:34:00Z" },
];

test("18 Uhr Berlin im November ist dunkel", () => {
  assert.equal(isDark(new Date("2026-11-14T17:02:00Z"), DAYS), true);
});

test("Mittag ist hell", () => {
  assert.equal(isDark(new Date("2026-11-14T10:07:00Z"), DAYS), false);
});

test("Dämmerung kurz vor Sonnenuntergang zählt schon als dunkel", () => {
  assert.equal(isDark(new Date("2026-11-14T15:15:00Z"), DAYS), true);
});

test("früh morgens vor Aufgang ist dunkel", () => {
  assert.equal(isDark(new Date("2026-11-15T06:10:00Z"), DAYS), true);
});

test("ohne Wetterdaten: feste Zeiten", () => {
  assert.equal(isDark(new Date("2026-11-14T17:30:00Z"), []), true);
  assert.equal(isDark(new Date("2026-11-14T11:00:00Z"), []), false);
});

test("Standard: nur Zufahrtskameras mit Weißlicht", () => {
  assert.equal(spotlightWanted({ id: 9, name: "Kamera Eingang" }, true, undefined), true);
  assert.equal(spotlightWanted({ id: 9, name: "Kamera Eingang" }, false, undefined), false);
  assert.equal(spotlightWanted({ id: 4, name: "Kamera Halle" }, true, undefined), false);
  assert.equal(spotlightWanted({ id: 5, name: "Kamera Torhaus" }, true, undefined), false);
});

test("Umgebung: aus oder feste IDs", () => {
  assert.equal(spotlightWanted({ id: 9, name: "Kamera Eingang" }, true, "0"), false);
  assert.equal(spotlightWanted({ id: 4, name: "Kamera Halle" }, true, "4, 9"), true);
  assert.equal(spotlightWanted({ id: 9, name: "Kamera Eingang" }, true, "4"), false);
});

test("Burst im Dunkeln: ein Licht, das aus ist, schaltet er selbst; eines, das schon brennt, lässt er, wie es ist", () => {
  assert.equal(burstSwitchesLight({ lit: false, goingOff: false }), true);
  // Von Hand eingeschaltet: nutzen, nicht anfassen, am Ende nicht ausschalten.
  assert.equal(burstSwitchesLight({ lit: true, goingOff: false }), false);
});

test("Burst im Dunkeln: schaltet der Hub das brennende Licht gerade selbst aus, schaltet der Burst es wieder ein", () => {
  // Die Kamera meldet es noch als brennend, beim ersten Bild wäre es aus.
  assert.equal(burstSwitchesLight({ lit: true, goingOff: true }), true);
  // Der Befehl hat schon gewirkt: ein Burst im Dunkeln wie jeder andere.
  assert.equal(burstSwitchesLight({ lit: false, goingOff: true }), true);
});

// Gemerktes Licht des vorigen Prozesses: vor 20 s eingeschaltet, Kamera bekannt und erreichbar.
const NOW = Date.parse("2026-11-25T18:00:00Z");
const LEFT_ON = { now: NOW, markedAt: NOW - 20_000, known: true, reachable: true, inUse: false, lastTryAt: 0 };

test("Gemerktes Licht: ausschalten, sobald die Kamera bekannt und erreichbar ist", () => {
  assert.equal(lightMarkStep(LEFT_ON), "off");
  // Kamera-Liste noch nicht geladen oder Kamera daraus entfernt: warten, nichts verwerfen.
  assert.equal(lightMarkStep({ ...LEFT_ON, known: false, reachable: false }), "wait");
  // Bekannt, aber sie antwortet nicht: warten, bis sie wieder da ist.
  assert.equal(lightMarkStep({ ...LEFT_ON, reachable: false }), "wait");
});

test("Gemerktes Licht: solange an der Kamera ein Burst läuft, bleibt es an", () => {
  assert.equal(lightMarkStep({ ...LEFT_ON, inUse: true }), "wait");
  // Auch ein alter Merker wartet das Ende des Bursts ab.
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - LIGHT_MARK_MAX_AGE_MS - 1, inUse: true }), "wait");
});

test("Gemerktes Licht: scheitert das Ausschalten, kommt der nächste Versuch nach einer Minute", () => {
  assert.equal(lightMarkStep({ ...LEFT_ON, lastTryAt: NOW - 2_000 }), "wait");
  assert.equal(lightMarkStep({ ...LEFT_ON, lastTryAt: NOW - 59_999 }), "wait");
  assert.equal(lightMarkStep({ ...LEFT_ON, lastTryAt: NOW - 60_000 }), "off");
});

test("Gemerktes Licht: nach 24 h wird der Merker verworfen und die Kamera nicht mehr angefasst", () => {
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - LIGHT_MARK_MAX_AGE_MS }), "off");
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - LIGHT_MARK_MAX_AGE_MS - 1 }), "drop");
  // Gilt auch für eine Kamera, die es nicht mehr gibt oder die nicht antwortet.
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - 25 * 3_600_000, known: false, reachable: false }), "drop");
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - 25 * 3_600_000, reachable: false }), "drop");
});
