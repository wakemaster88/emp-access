import { test } from "node:test";
import assert from "node:assert/strict";
import { isDark, spotlightWanted } from "./vehicle-light-rules.js";

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
