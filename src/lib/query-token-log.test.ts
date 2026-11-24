import { test } from "node:test";
import assert from "node:assert/strict";
import { _clearQueryTokenLog, queryTokenLogLine, shouldLogQueryToken } from "./query-token-log";

test("höchstens eine Zeile je Route und Stunde", () => {
  _clearQueryTokenLog();
  const t0 = 1_000_000;
  assert.equal(shouldLogQueryToken("/api/gate", t0), true);
  assert.equal(shouldLogQueryToken("/api/gate", t0 + 1_000), false);
  assert.equal(shouldLogQueryToken("/api/occupancy", t0 + 1_000), true);
  assert.equal(shouldLogQueryToken("/api/gate", t0 + 59 * 60_000), false);
  assert.equal(shouldLogQueryToken("/api/gate", t0 + 60 * 60_000), true);
});

test("Merker bleibt begrenzt", () => {
  _clearQueryTokenLog();
  for (let i = 0; i < 600; i++) assert.equal(shouldLogQueryToken(`/api/devices/${i}/open`, 5), true);
  // Der älteste Eintrag ist verdrängt, der jüngste noch gemerkt.
  assert.equal(shouldLogQueryToken("/api/devices/0/open", 6), true);
  assert.equal(shouldLogQueryToken("/api/devices/599/open", 6), false);
});

test("Zeile enthält Präfix, Pfad und Art", () => {
  assert.equal(queryTokenLogLine("/api/gate", "account"), '[api-token-query] {"path":"/api/gate","kind":"account"}');
  assert.equal(queryTokenLogLine("/api/devices/pi", "device"), '[api-token-query] {"path":"/api/devices/pi","kind":"device"}');
});
