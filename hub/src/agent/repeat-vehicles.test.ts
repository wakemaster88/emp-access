import { test } from "node:test";
import assert from "node:assert/strict";
import { REASK_MS, VISIT_GAP_MS, markPlate, notePlate, type PlateBook } from "./repeat-vehicles.js";

const H = 60 * 60_000;

test("Dritter Besuch fragt einmal, Sichtungen im selben Besuch zaehlen nicht", () => {
  const book: PlateBook = {};
  assert.equal(notePlate(book, "BOR-AB 123", 0, { minVisits: 3 }), false);
  assert.equal(notePlate(book, "BOR AB123", 10 * 60_000, { minVisits: 3 }), false);
  assert.equal(book.BORAB123.visits, 1);
  assert.equal(notePlate(book, "BOR-AB 123", 10 * 60_000 + VISIT_GAP_MS, { minVisits: 3 }), false);
  assert.equal(notePlate(book, "BOR-AB 123", 10 * 60_000 + 2 * VISIT_GAP_MS, { minVisits: 3 }), true);
  assert.equal(notePlate(book, "BOR-AB 123", 10 * 60_000 + 3 * VISIT_GAP_MS, { minVisits: 3 }), false);
});

test("Abgelehnt oder genehmigt wird nie wieder gefragt, offen nach einer Woche", () => {
  const book: PlateBook = {};
  for (let i = 0; i < 3; i++) notePlate(book, "MS-X 1", i * 3 * H, { minVisits: 3 });
  assert.equal(book.MSX1.state, "asked");
  assert.equal(notePlate(book, "MS-X 1", 6 * H + REASK_MS + 1, { minVisits: 3 }), true);
  markPlate(book, "MS-X 1", "declined");
  assert.equal(notePlate(book, "MS-X 1", 20 * REASK_MS, { minVisits: 3 }), false);
});

test("Zu kurze Kennzeichen werden ignoriert", () => {
  assert.equal(notePlate({}, "AB", 0, { minVisits: 1 }), false);
});
