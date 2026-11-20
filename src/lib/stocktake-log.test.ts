import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalContent, describeEvent, lineChanges, shortHash, signBlockedReason, signatureStatus } from "./stocktake-log";
import { hashContent } from "./stocktake-audit";

test("canonicalContent ist unabhängig von der Reihenfolge", () => {
  const a = [
    { id: 2, counted: 1, broken: null, purchasePriceCents: 99 },
    { id: 1, counted: null, broken: 0.5, purchasePriceCents: null },
  ];
  assert.equal(canonicalContent(a), canonicalContent([...a].reverse()));
  assert.equal(canonicalContent(a), "1::0.5:|2:1::99");
});

test("hashContent ändert sich mit jeder Menge", () => {
  const base = [{ id: 1, counted: 3, broken: null, purchasePriceCents: 100 }];
  const h = hashContent(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, hashContent([{ ...base[0], counted: 4 }]));
  assert.notEqual(h, hashContent([{ ...base[0], purchasePriceCents: 101 }]));
  assert.equal(shortHash(h).split(" ").length, 4);
});

test("lineChanges meldet nur echte Änderungen", () => {
  assert.deepEqual(lineChanges({ counted: 3, broken: null }, { counted: 3 }), []);
  assert.deepEqual(lineChanges({ counted: null, broken: null }, { counted: 0, broken: undefined }), [
    { field: "counted", oldValue: null, newValue: 0 },
  ]);
  assert.deepEqual(lineChanges({ counted: 2 }, { counted: null }), [{ field: "counted", oldValue: 2, newValue: null }]);
});

test("Zähler und Schreiber müssen verschiedene Personen sein", () => {
  const sigs = [{ role: "COUNTER" as const, adminId: 7, name: "Anna", contentHash: "h" }];
  assert.match(signBlockedReason(sigs, "WRITER", 7) ?? "", /zwei verschiedene Personen/);
  assert.match(signBlockedReason(sigs, "COUNTER", 8) ?? "", /schon bestätigt/);
  assert.equal(signBlockedReason(sigs, "WRITER", 8), null);
});

test("signatureStatus verlangt beide Bestätigungen zum aktuellen Stand", () => {
  const counter = { role: "COUNTER" as const, adminId: 1, name: "A", contentHash: "neu" };
  const writer = { role: "WRITER" as const, adminId: 2, name: "B", contentHash: "alt" };
  assert.deepEqual(signatureStatus([counter, writer], "neu").missing, ["WRITER"]);
  assert.equal(signatureStatus([counter, { ...writer, contentHash: "neu" }], "neu").complete, true);
});

test("describeEvent beschreibt Korrekturen mit alt, neu und Grund", () => {
  const text = describeEvent({
    type: "CORRECTION",
    lineName: "Cola 0,33",
    field: "purchasePriceCents",
    oldValue: 63,
    newValue: 73,
    actor: "Aaron",
    via: "app",
    note: "Rechnung Zumdiek",
  });
  assert.equal(text, "Korrektur Cola 0,33 · EK netto: 0,63 € → 0,73 € · Grund: Rechnung Zumdiek");
});
