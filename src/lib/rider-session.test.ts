import { test } from "node:test";
import assert from "node:assert/strict";
import { riderPasswordError, signRiderSession, verifyRiderSession } from "./rider-session";

const SECRET = "test-secret";
const NOW = new Date("2027-06-01T12:00:00Z");

test("Sitzung: signieren und prüfen", () => {
  const value = signRiderSession({ profileId: 42, version: 3 }, SECRET, NOW);
  assert.deepEqual(verifyRiderSession(value, SECRET, NOW), { profileId: 42, version: 3 });
});

test("Sitzung: falscher Schlüssel, Manipulation und Ablauf werden abgelehnt", () => {
  const value = signRiderSession({ profileId: 42, version: 3 }, SECRET, NOW);
  assert.equal(verifyRiderSession(value, "anderer", NOW), null);
  assert.equal(verifyRiderSession(value.replace(/^42\./, "43."), SECRET, NOW), null);
  assert.equal(verifyRiderSession(value, SECRET, new Date("2028-06-01T12:00:00Z")), null);
  assert.equal(verifyRiderSession(undefined, SECRET, NOW), null);
  assert.equal(verifyRiderSession("1.2.3", SECRET, NOW), null);
  assert.equal(verifyRiderSession(value, "", NOW), null);
});

test("riderPasswordError", () => {
  assert.equal(riderPasswordError("12345678"), null);
  assert.notEqual(riderPasswordError("1234567"), null);
  assert.notEqual(riderPasswordError(undefined), null);
  assert.notEqual(riderPasswordError("x".repeat(201)), null);
});
