import assert from "node:assert/strict";
import { test } from "node:test";
import { GERMAN_CITY_CODES } from "./plate-cities";
import { matchAllowedPlate, normalizePlate, plainUmlautForm } from "./plate-match";
import { GERMAN_CITY_CODES as HUB_CITY_CODES } from "../../hub/src/plate-cities";
import { UMLAUT_MATCH_CASES } from "../../hub/src/plate-umlaut-cases";

/** Listen-Einträge wie in der Datenbank (plateNormalized mit AE/OE/UE). */
const listOf = (plates: string[]) =>
  plates.map((plate, i) => ({ id: i + 1, plate, plateNormalized: normalizePlate(plate) }));

test("Kreis-Liste der Cloud ist dieselbe wie am Hub", () => {
  assert.deepEqual([...GERMAN_CITY_CODES].sort(), [...HUB_CITY_CODES].sort());
});

test("Kreis mit Umlaut: Abgleich wie am Hub (gemeinsame Testfälle)", () => {
  assert.ok(UMLAUT_MATCH_CASES.length > 10);
  for (const c of UMLAUT_MATCH_CASES) {
    const hit = matchAllowedPlate(normalizePlate(c.reading), listOf(c.list));
    assert.equal(hit?.plate ?? null, c.hit, c.name);
  }
});

test("Schreibweise ohne Umlaut: nur ohne Verwechslung mit einem anderen Kreis", () => {
  assert.equal(plainUmlautForm("LÜD-AB 123"), "LUDAB123");
  assert.equal(plainUmlautForm("LÜDAB123"), "LUDAB123");
  assert.equal(plainUmlautForm("BÖ-AB 123"), null);
  assert.equal(plainUmlautForm("GÖ-AB 123"), null);
  assert.equal(plainUmlautForm("LÜN-A 123"), null);
  assert.equal(plainUmlautForm("GT-AB 4321"), null);
});

test("normalizePlate: unverändert (Ä/Ö/Ü zu AE/OE/UE, ohne Trennzeichen)", () => {
  assert.equal(normalizePlate(" lüd-ab 123 "), "LUEDAB123");
  assert.equal(normalizePlate("GT-AB 4321"), "GTAB4321");
  assert.equal(normalizePlate("Straße 1"), "STRASSE1");
});
