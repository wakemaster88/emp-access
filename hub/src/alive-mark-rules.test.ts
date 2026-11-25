import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAliveMark } from "./alive-mark-rules.js";

const now = Date.parse("2026-11-24T12:00:00Z");

test("Lebenszeichen: gespeicherte Zeit wird gelesen", () => {
  assert.equal(parseAliveMark('{"at":"2026-11-24T06:04:30.000Z"}', now), "2026-11-24T06:04:30.000Z");
  // Eine halbe Minute Uhrenabweichung ist erlaubt.
  assert.equal(parseAliveMark('{"at":"2026-11-24T12:00:30Z"}', now), "2026-11-24T12:00:30.000Z");
});

test("Lebenszeichen: Zukunft, kaputte oder fremde Inhalte gelten als unbekannt", () => {
  assert.equal(parseAliveMark('{"at":"2026-11-24T12:05:00Z"}', now), null);
  assert.equal(parseAliveMark('{"at":"gestern"}', now), null);
  assert.equal(parseAliveMark('{"at":1764000000000}', now), null);
  assert.equal(parseAliveMark("{}", now), null);
  assert.equal(parseAliveMark("null", now), null);
  assert.equal(parseAliveMark('{"at":"2026-11-24T06:0', now), null); // abgeschnitten
  assert.equal(parseAliveMark("", now), null);
});
