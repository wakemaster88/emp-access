import assert from "node:assert/strict";
import { test } from "node:test";
import { printableExtraLines } from "../components/checkin/checkin-utils";

test("Ticketdruck: Extras nur aus einer Liste", () => {
  assert.deepEqual(printableExtraLines([{ name: "Neopren", quantity: 2 }, { name: "Helm", quantity: 1 }]), ["2x Neopren", "Helm"]);
  assert.deepEqual(printableExtraLines(null), []);
  assert.deepEqual(printableExtraLines(undefined), []);
  assert.deepEqual(printableExtraLines([]), []);
});

test("Ticketdruck: Objekt in den Zusatzdaten (Pause-Vermerk) ergibt keine Zeile statt Fehler", () => {
  assert.deepEqual(printableExtraLines({}), []);
  assert.deepEqual(printableExtraLines({ pausedBy: "pause-all", pauseAllPrevStatus: "VALID", pauseAllAt: "2026-11-25T10:00:00.000Z" }), []);
  assert.deepEqual(printableExtraLines({ pausedAt: "2026-11-25T10:00:00.000Z", previousStatus: "VALID" }), []);
  assert.deepEqual(printableExtraLines("x"), []);
  assert.deepEqual(printableExtraLines(3), []);
});
