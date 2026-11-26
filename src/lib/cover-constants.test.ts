import assert from "node:assert/strict";
import { test } from "node:test";
import { COVER_INTERLOCK_MS, COVER_NOT_CONFIGURED, coverDrivePlan } from "./cover-constants";
import { shellyCoverComponentId, type ShellyDeviceStatusMap } from "./shelly-cloud";
import { INTERLOCK_CASES } from "../../hub/src/cover-interlock-cases";

// Dieselben Faelle prueft der Hub (hub/src/cover-rules.test.ts): Im
// Notbetrieb faehrt er ein Rolltor mit derselben Verriegelung zu.
for (const c of INTERLOCK_CASES) {
  test(`coverDrivePlan: ${c.name}`, () => {
    const coverId = shellyCoverComponentId(c.status as ShellyDeviceStatusMap);
    assert.deepEqual(coverDrivePlan(coverId, c.device, c.action), c.plan);
  });
}

test("coverDrivePlan: Umschaltpause und Meldung wie bisher", () => {
  assert.equal(COVER_INTERLOCK_MS, 500);
  assert.match(COVER_NOT_CONFIGURED, /zwei verschiedene Shelly-Kanäle/);
});
