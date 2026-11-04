import assert from "node:assert/strict";
import { test } from "node:test";
import { roomRuleActionSchema } from "./validators";

test("Kamera-Aktion braucht Kamera und Preset oder Folgen", () => {
  assert.equal(roomRuleActionSchema.safeParse({ kind: "CAMERA", ptzPresetId: 1 }).success, false);
  assert.equal(roomRuleActionSchema.safeParse({ kind: "CAMERA", targetCameraId: 3 }).success, false);
  assert.equal(
    roomRuleActionSchema.safeParse({ kind: "CAMERA", targetCameraId: 3, ptzPresetId: 0 }).success,
    true,
  );
  assert.equal(
    roomRuleActionSchema.safeParse({ kind: "CAMERA", targetCameraId: 3, autoTrack: false }).success,
    true,
  );
});

test("Zurück-Zeit nur 5 s bis 1 h", () => {
  const base = { kind: "CAMERA", targetCameraId: 3, ptzPresetId: 2, autoTrack: true };
  assert.equal(roomRuleActionSchema.safeParse({ ...base, returnAfterSeconds: 2 }).success, false);
  assert.equal(roomRuleActionSchema.safeParse({ ...base, returnAfterSeconds: 120 }).success, true);
});
