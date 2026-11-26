import { test } from "node:test";
import assert from "node:assert/strict";
import { COVER_INTERLOCK_MS, coverComponentId, coverDrivePlan } from "./cover-rules.js";
import { INTERLOCK_CASES } from "./cover-interlock-cases.js";

// Dieselben Faelle prueft die Cloud (src/lib/cover-constants.test.ts).
for (const c of INTERLOCK_CASES) {
  test(`coverDrivePlan: ${c.name}`, () => {
    assert.deepEqual(coverDrivePlan(coverComponentId(c.status), c.device, c.action), c.plan);
  });
}

test("coverComponentId: Schluessel, die keine Antriebe sind, zaehlen nicht", () => {
  assert.equal(coverComponentId({ "cover:x": {}, "switch:0": {} }), null);
  assert.equal(coverComponentId({ "cover:2": {} }), 2);
  assert.equal(COVER_INTERLOCK_MS, 500);
});
