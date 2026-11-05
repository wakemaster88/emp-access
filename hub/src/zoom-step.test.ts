import { test } from "node:test";
import assert from "node:assert/strict";
import { zoomStep } from "./zoom-step.js";

test("Nah/Weit gehen in Achtel-Schritten", () => {
  assert.equal(zoomStep(0, 0, 33, 1), 4);
  assert.equal(zoomStep(20, 0, 33, -1), 16);
});

test("Zoom bleibt im Bereich", () => {
  assert.equal(zoomStep(32, 0, 33, 1), 33);
  assert.equal(zoomStep(1, 0, 33, -1), 0);
});

test("kleiner Bereich: mindestens ein Schritt", () => {
  assert.equal(zoomStep(2, 0, 5, 1), 3);
});
