import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidatesFromOff,
  countLinkState,
  isPlausibleCountToken,
  defaultCutoffDate,
  matchScore,
  parseEuroToCents,
  parseGermanNumber,
  stocktakeTotals,
  toCsv,
  totalsByCategory,
} from "./warenwirtschaft";

test("parseGermanNumber versteht Komma, Punkt und Tausenderpunkt", () => {
  assert.equal(parseGermanNumber("1,5"), 1.5);
  assert.equal(parseGermanNumber("1.5"), 1.5);
  assert.equal(parseGermanNumber("1.234,5"), 1234.5);
  assert.equal(parseGermanNumber(""), null);
  assert.equal(parseGermanNumber("abc"), undefined);
});

test("parseEuroToCents", () => {
  assert.equal(parseEuroToCents("12,50 €"), 1250);
  assert.equal(parseEuroToCents("4.49"), 449);
  assert.equal(parseEuroToCents(""), null);
  assert.equal(parseEuroToCents("-1"), undefined);
});

test("stocktakeTotals bewertet Bestand, Bruch und Differenz", () => {
  const t = stocktakeTotals([
    { category: "Getränke", purchasePriceCents: 449, expected: 2, counted: 3, broken: 1 },
    { category: "Getränke", purchasePriceCents: 1000, expected: 5, counted: null, broken: null },
    { category: "Speisen", purchasePriceCents: null, expected: 0, counted: 4, broken: null },
  ]);
  assert.equal(t.lines, 3);
  assert.equal(t.counted, 2);
  assert.equal(t.valueCents, 1347);
  assert.equal(t.brokenCents, 449);
  assert.equal(t.diffCents, 449);
  const byCat = totalsByCategory([
    { category: "Speisen", purchasePriceCents: 100, expected: 0, counted: 1, broken: null },
    { category: "Getränke", purchasePriceCents: 100, expected: 0, counted: 2, broken: null },
  ]);
  assert.deepEqual(byCat.map((c) => [c.category, c.totals.valueCents]), [["Getränke", 200], ["Speisen", 100]]);
});

test("toCsv setzt Semikolon, BOM und Anführungszeichen", () => {
  assert.equal(toCsv([["a;b", 1.5, null]]), '﻿"a;b";1,5;\r\n');
});

test("defaultCutoffDate nimmt im Januar das Vorjahr", () => {
  assert.equal(defaultCutoffDate(new Date(2026, 0, 10)), "2025-12-31");
  assert.equal(defaultCutoffDate(new Date(2026, 10, 18)), "2026-12-31");
});

test("matchScore verlangt die wesentlichen Wörter des Artikels", () => {
  assert.equal(matchScore("Bols Blue Curacao", "Blue Curaçao", "Bols"), 1);
  assert.equal(matchScore("Magnum Mandel", "Magnum Classic", "Langnese"), 0.5);
  assert.equal(matchScore("Aperol Spritz 0,2l", "Aperol Spritz", ""), 1);
});

test("candidatesFromOff sortiert nach Treffer und verlangt https-Bilder", () => {
  const c = candidatesFromOff("Bols Blue Curacao", [
    { code: "1", product_name: "Triple Sec", brands: "Bols", image_front_url: "https://img/1.jpg" },
    { code: "2", product_name: "Blue Curacao", brands: "Bols", image_front_url: "https://img/2.jpg" },
    { code: "3", product_name: "Blue Curacao", brands: "Bols", image_front_url: "http://img/3.jpg" },
  ]);
  assert.deepEqual(c.map((x) => x.code), ["2", "1"]);
  assert.equal(c[0].productUrl, "https://world.openfoodfacts.org/product/2");
});

test("countLinkState: nur offene Inventur mit gültigem Link", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const later = new Date("2026-11-20T10:00:00Z");
  const earlier = new Date("2026-11-17T10:00:00Z");
  assert.equal(countLinkState({ status: "OPEN", countToken: "x", countTokenExpiresAt: later }, now), "OK");
  assert.equal(countLinkState({ status: "OPEN", countToken: "x", countTokenExpiresAt: null }, now), "OK");
  assert.equal(countLinkState({ status: "OPEN", countToken: "x", countTokenExpiresAt: earlier }, now), "EXPIRED");
  assert.equal(countLinkState({ status: "OPEN", countToken: null, countTokenExpiresAt: later }, now), "NONE");
  assert.equal(countLinkState({ status: "CLOSED", countToken: "x", countTokenExpiresAt: later }, now), "CLOSED");
});

test("isPlausibleCountToken prüft Länge und Zeichen", () => {
  assert.equal(isPlausibleCountToken("a".repeat(43)), true);
  assert.equal(isPlausibleCountToken("kurz"), false);
  assert.equal(isPlausibleCountToken("a".repeat(42) + "/"), false);
  assert.equal(isPlausibleCountToken(undefined), false);
});
