import { test } from "node:test";
import assert from "node:assert/strict";

test("aboRuntimeLabel: Laufzeit für die Abo-Auswahl", async () => {
  const { aboRuntimeLabel } = await import("./rider-onboarding");
  const now = new Date("2026-11-20T12:00:00Z");
  assert.equal(aboRuntimeLabel(null, now), "ohne Enddatum");
  assert.equal(aboRuntimeLabel(new Date("2027-05-31T21:59:00Z"), now), "bis 31.05.2027");
  assert.equal(aboRuntimeLabel(new Date("2026-10-31T22:59:00Z"), now), "abgelaufen am 31.10.2026");
});
