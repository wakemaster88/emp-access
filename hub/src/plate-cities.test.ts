import { test } from "node:test";
import assert from "node:assert/strict";
import { GERMAN_CITY_CODES, LOCAL_CITY_CODES, UMLAUT_CITY_BY_PLAIN } from "./plate-cities.js";
import { withoutUmlaut } from "./plate-match.js";

test("Kreise mit Umlaut: kein Schlüssel ist selbst ein Kreis der Liste", () => {
  assert.ok(UMLAUT_CITY_BY_PLAIN.size > 0);
  for (const plain of UMLAUT_CITY_BY_PLAIN.keys()) {
    assert.equal(GERMAN_CITY_CODES.has(plain), false, plain);
  }
});

test("Kreise mit Umlaut: jede Zuordnung ändert nur Umlaute", () => {
  for (const [plain, city] of UMLAUT_CITY_BY_PLAIN) {
    assert.match(plain, /^[A-Z]{2,3}$/, plain);
    assert.match(city, /[ÄÖÜ]/, city);
    assert.equal(withoutUmlaut(city), plain, city);
  }
});

test("BO bleibt Bochum", () => {
  assert.equal(GERMAN_CITY_CODES.has("BO"), true);
  assert.equal(UMLAUT_CITY_BY_PLAIN.has("BO"), false);
  assert.ok(![...UMLAUT_CITY_BY_PLAIN.values()].some((c) => withoutUmlaut(c) === "BO"));
});

test("Kreise der Region stehen in der Liste", () => {
  for (const c of LOCAL_CITY_CODES) assert.equal(GERMAN_CITY_CODES.has(c), true, c);
});
