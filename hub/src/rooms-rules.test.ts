import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheSyncedAt } from "./rooms-rules.js";

test("cacheSyncedAt: vermerkter Abruf, sonst die Zeit der Cloud-Antwort", () => {
  assert.equal(cacheSyncedAt({ syncedAt: "2026-11-25T16:58:00.000Z", at: "2026-11-25T16:57:59.000Z" }), "2026-11-25T16:58:00.000Z");
  assert.equal(cacheSyncedAt({ at: "2026-11-25T16:57:59.000Z" }), "2026-11-25T16:57:59.000Z");
  assert.equal(cacheSyncedAt({ syncedAt: "kaputt", at: "2026-11-25T16:57:59.000Z" }), "2026-11-25T16:57:59.000Z");
  assert.equal(cacheSyncedAt({}), null);
});
