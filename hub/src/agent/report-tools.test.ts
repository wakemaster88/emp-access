import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportToolAllowed } from "./report-tools.js";

test("Tagesbericht: nur lesende Werkzeuge ohne Bildversand", () => {
  assert.equal(reportToolAllowed("hub_status", "read"), true);
  assert.equal(reportToolAllowed("remember", "act"), false);
  assert.equal(reportToolAllowed("switch_device", "act"), false);
  assert.equal(reportToolAllowed("camera_snapshot", "read"), false);
  assert.equal(reportToolAllowed("look_at_camera", "read"), false);
  assert.equal(reportToolAllowed("unbekannt", undefined), false);
});

// tools.ts laedt beim Import CONFIG und Geraetemodule, deshalb Blick in den Quelltext.
test("remember braucht den Bestaetigungsknopf (risk act)", () => {
  const src = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
  const start = src.indexOf('name: "remember"');
  assert.ok(start >= 0, "remember nicht gefunden");
  const risk = /risk:\s*"(\w+)"/.exec(src.slice(start));
  assert.equal(risk?.[1], "act");
});
