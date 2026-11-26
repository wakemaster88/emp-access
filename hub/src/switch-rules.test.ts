import { test } from "node:test";
import assert from "node:assert/strict";
import { envSwitch, unknownSwitchLine } from "./switch-rules.js";

test("envSwitch: Standard an, 0/false/nein/aus/no/off schalten ab", () => {
  assert.equal(envSwitch(undefined), true);
  assert.equal(envSwitch(""), true);
  assert.equal(envSwitch("  "), true);
  for (const off of ["0", "false", "nein", "aus", "no", "off", "FALSE", " Nein ", "Off", "AUS", "No"]) assert.equal(envSwitch(off), false, off);
  for (const on of ["1", "true", "ja", "an", "yes", "on", "TRUE", " An "]) assert.equal(envSwitch(on), true, on);
  // Unbekannt: Standard.
  assert.equal(envSwitch("vielleicht"), true);
  assert.equal(envSwitch("vielleicht", false), false);
  assert.equal(envSwitch(undefined, false), false);
});

test("envSwitch: unbekannter Wert wird gemeldet, bekannte und leere nicht", () => {
  const seen: string[] = [];
  const note = (v: string) => seen.push(v);
  assert.equal(envSwitch(" ausschalten ", true, note), true);
  assert.equal(envSwitch("0", true, note), false);
  assert.equal(envSwitch("aus", true, note), false);
  assert.equal(envSwitch("ja", true, note), true);
  assert.equal(envSwitch("", true, note), true);
  assert.equal(envSwitch(undefined, true, note), true);
  assert.deepEqual(seen, ["ausschalten"]);
});

test("unknownSwitchLine: nennt Schalter, Wert, was gilt und was abschaltet", () => {
  const line = unknownSwitchLine("HUB_RULES_LOCAL_MOTION", "ausschalten");
  assert.match(line, /^Warnung: HUB_RULES_LOCAL_MOTION="ausschalten"/);
  assert.match(line, /bleibt an \(Standard\)/);
  assert.match(line, /Aus: 0, false, nein, aus, no, off/);
  assert.match(unknownSwitchLine("X", "y", false), /bleibt aus/);
  // Ein langer Wert wird gekuerzt.
  assert.ok(unknownSwitchLine("X", "z".repeat(500)).length < 200);
});
