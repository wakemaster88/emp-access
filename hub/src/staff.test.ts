import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStaffResponse } from "./staff-parse.js";

test("Personal-Antwort der Cloud wird geprueft", () => {
  const snap = parseStaffResponse({
    configured: true,
    fetchedAt: "2026-11-05T12:00:00.000Z",
    working: [{ id: "1", name: "Anna", department: null, since: null, onBreak: false }, { id: "2" }],
    shifts: [{ department: "Shop", pending: ["Ben"] }, { department: "kaputt" }],
  });
  assert.ok(snap);
  assert.deepEqual(snap.working.map((w) => w.name), ["Anna"]);
  assert.equal(snap.shifts.length, 1);
});

test("Antwort ohne Personaldaten wird verworfen", () => {
  assert.equal(parseStaffResponse({ configured: false, reason: "x" }), null);
  assert.equal(parseStaffResponse(null), null);
});
