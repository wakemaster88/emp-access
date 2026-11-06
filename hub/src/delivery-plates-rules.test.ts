import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATE_MAX, brandForPlate, rememberPlate, type PlateMemory } from "./delivery-plates-rules.js";

const DAY = 24 * 60 * 60_000;
const T0 = Date.UTC(2026, 10, 6, 11, 0);

test("Kennzeichen mit Marke merken und wiedererkennen", () => {
  const mem: PlateMemory = {};
  assert.equal(rememberPlate(mem, "BN-PL 8546", "DHL", T0), true);
  assert.equal(brandForPlate(mem, "bn pl8546", T0 + DAY), "DHL");
  assert.equal(brandForPlate(mem, "BN-PL 8547", T0 + DAY), null);
});

test("Kurze oder leere Kennzeichen nicht merken", () => {
  const mem: PlateMemory = {};
  assert.equal(rememberPlate(mem, "AB1", "DHL", T0), false);
  assert.equal(brandForPlate(mem, "AB1", T0), null);
  assert.deepEqual(mem, {});
});

test("Verfällt nach 90 Tagen ohne Sichtung, jede Sichtung verlängert", () => {
  const mem: PlateMemory = {};
  rememberPlate(mem, "BN-PL 8546", "DHL", T0);
  assert.equal(rememberPlate(mem, "BN-PL 8546", "DHL", T0 + 89 * DAY), false);
  assert.equal(mem.BNPL8546.seen, 2);
  assert.equal(brandForPlate(mem, "BN-PL 8546", T0 + 150 * DAY), "DHL");
  assert.equal(brandForPlate(mem, "BN-PL 8546", T0 + 179 * DAY), null);
});

test("Höchstens 200 Kennzeichen, die am längsten nicht gesehenen fallen raus", () => {
  const mem: PlateMemory = {};
  for (let i = 0; i <= PLATE_MAX; i++) rememberPlate(mem, `DO-X ${1000 + i}`, "UPS", T0 + i);
  assert.equal(Object.keys(mem).length, PLATE_MAX);
  assert.equal(brandForPlate(mem, "DO-X 1000", T0 + PLATE_MAX), null);
  assert.equal(brandForPlate(mem, `DO-X ${1000 + PLATE_MAX}`, T0 + PLATE_MAX), "UPS");
});
