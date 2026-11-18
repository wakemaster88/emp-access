import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWawiWorkbook, yearFromHeader } from "./warenwirtschaft-import";

test("yearFromHeader liest die Spaltenköpfe der Inventarvorlage", () => {
  assert.equal(yearFromHeader("Menge 31.12.20"), 2020);
  assert.equal(yearFromHeader("Menge 25.10.2023"), 2023);
  assert.equal(yearFromHeader("Menge 2025"), 2025);
  assert.equal(yearFromHeader(44926), 2022); // Datumszahl 31.12.2022
  assert.equal(yearFromHeader("Bereich"), null);
});

test("Inventurliste: Artikel, Kategorie aus dem Blatt und Stichtag aus dem Kopf", () => {
  const r = parseWawiWorkbook([
    { name: "Zusammenfassung", rows: [["Übersicht"], ["Inventur zum 31.12.2025"]] },
    {
      name: "Inventur Getränke",
      rows: [
        ["Inventurliste Getränke 2025"],
        ["Bezeichnung", "Artikel-Nr.", "Einheit", "Lieferant", "EK netto", "Ist Bestand", "Lagerwert", "Bruch"],
        ["Aperol ", 901604, "FL 1,00", "Zumdiek", 10.68, 2, 21.36, 1],
        [null, null, null, null, null, null, 21.36],
        ["Gesamt"],
      ],
    },
    { name: "Inventur Speisen", rows: [["x"], ["Produkt", "Menge", "Einheit", "Preis pro Einheit"], ["Pommes", 3, "Kartons", 20.5]] },
  ]);
  assert.equal(r.cutoffDate, "2025-12-31");
  assert.deepEqual(r.articles.map((a) => [a.name, a.sku, a.category, a.purchasePriceCents, a.stock, a.broken]), [
    ["Aperol", "901604", "Getränke", 1068, 2, 1],
    ["Pommes", null, "Speisen", 2050, 3, null],
  ]);
  assert.deepEqual(r.skipped, ["Zusammenfassung"]);
});

test("Inventarliste: Blatt, Bereich, Gerätenummer und Mengen je Jahr", () => {
  const r = parseWawiWorkbook([
    {
      name: "BüroShop",
      rows: [
        ["Artikel", "Gerätenummer", "Letzte Prüfung", "Bereich", "Menge 31.12.21", "Menge 2024", "Menge 2025"],
        ["Kassen PC", 3619632, 45000, "Shop", 2, null, 1],
      ],
    },
  ]);
  assert.equal(r.articles.length, 0);
  assert.deepEqual(r.assets, [
    { name: "Kassen PC", group: "Büro & Shop", location: "Shop", deviceNumber: "3619632", lastInspection: "2023-03-15", counts: [{ year: 2021, quantity: 2 }, { year: 2025, quantity: 1 }] },
  ]);
});
