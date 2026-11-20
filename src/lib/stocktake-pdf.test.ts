import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStocktakePdf, pdfEuro, stocktakePdfFileName } from "./stocktake-pdf";

test("pdfEuro formatiert deutsch ohne Sonderleerzeichen", () => {
  assert.equal(pdfEuro(123450), "1.234,50 €");
  assert.equal(pdfEuro(0), "0,00 €");
  assert.equal(pdfEuro(null), "–");
});

test("stocktakePdfFileName entfernt Sonderzeichen", () => {
  assert.equal(stocktakePdfFileName("Stichtag 31.12.2025 / Gastro"), "Stichtag_31.12.2025_Gastro.pdf");
  assert.equal(stocktakePdfFileName("///"), "Inventur.pdf");
});

test("buildStocktakePdf erzeugt ein mehrseitiges PDF", () => {
  const lines = Array.from({ length: 120 }, (_, i) => ({
    name: `Artikel ${i}`,
    sku: String(1000 + i),
    unit: "Stück",
    category: i % 2 ? "Getränke" : "Speisen",
    purchasePriceCents: i % 10 === 0 ? null : 100 + i,
    expected: 2,
    counted: i % 9 === 0 ? null : 3,
    broken: i === 5 ? 1 : null,
  }));
  const buf = buildStocktakePdf({
    accountName: "Testbetrieb",
    kind: "CUTOFF",
    title: "Stichtag 31.12.2025",
    date: new Date("2025-12-31T00:00:00Z"),
    status: "CLOSED",
    closedAt: new Date("2026-01-02T10:00:00Z"),
    closedBy: "Test",
    lines,
    createdAt: new Date("2026-01-03T10:00:00Z"),
  });
  const head = Buffer.from(buf).subarray(0, 5).toString("latin1");
  assert.equal(head, "%PDF-");
  const pages = Buffer.from(buf).toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
  assert.ok(pages >= 3, `erwartet mehrere Seiten, bekommen ${pages}`);
});

test("buildStocktakePdf zeigt Bestätigung, Korrekturen und Protokoll", () => {
  const at = new Date("2026-01-02T10:00:00Z");
  const buf = buildStocktakePdf({
    accountName: "Testbetrieb",
    kind: "CUTOFF",
    title: "Stichtag 31.12.2025",
    date: new Date("2025-12-31T00:00:00Z"),
    status: "CLOSED",
    closedAt: at,
    closedBy: "Test",
    lines: [{ name: "Cola", sku: "1", unit: "FL", category: "Getränke", purchasePriceCents: 63, expected: 1, counted: 2, broken: null }],
    signatures: [
      { role: "COUNTER", name: "Anna Zähler", email: "anna@example.org", method: "passkey", signedAt: at, contentHash: "ab".repeat(32) },
      { role: "WRITER", name: "Ben Schreiber", email: null, method: "password", signedAt: at, contentHash: "ab".repeat(32) },
    ],
    events: [
      { type: "COUNT", lineName: "Cola", field: "counted", oldValue: null, newValue: 2, actor: "Anna", via: "link", note: null, createdAt: at },
      { type: "CORRECTION", lineName: "Cola", field: "purchasePriceCents", oldValue: 63, newValue: 73, actor: "Aaron", via: "app", note: "Rechnung", createdAt: at },
    ],
    createdAt: at,
  });
  const raw = Buffer.from(buf).toString("latin1");
  assert.ok(raw.includes("Anna Z"), "Name des Zählers fehlt");
  assert.ok(raw.includes("Korrekturen nach dem Festschreiben"));
  assert.ok(raw.includes("Anhang: Protokoll"));
  assert.ok(!raw.includes("Aufgenommen / Unterschrift"));
});
