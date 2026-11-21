import { test } from "node:test";
import assert from "node:assert/strict";
import { aboEndState, aboTariffLabel } from "./abo-term";

test("Tarif ohne Abo-Namen", () => {
  assert.equal(aboTariffLabel("Ride Abo | 12M"), "12 Monate");
  assert.equal(aboTariffLabel("Ride Abo | 1M"), "1 Monat");
  assert.equal(aboTariffLabel("Beach Abo | Saison"), "Saison");
  assert.equal(aboTariffLabel("Jahreskarte"), "Jahreskarte");
  assert.equal(aboTariffLabel("  "), null);
  assert.equal(aboTariffLabel(null), null);
});

test("Ende der Laufzeit", () => {
  const now = new Date("2026-11-21T10:00:00Z");
  assert.deepEqual(aboEndState(new Date("2027-04-06T00:00:00Z"), now), { label: "bis 06.04.27", tone: "muted" });
  assert.deepEqual(aboEndState(new Date("2026-11-26T12:00:00Z"), now), { label: "noch 5 Tage", tone: "warning" });
  assert.deepEqual(aboEndState(new Date("2026-11-22T12:00:00Z"), now), { label: "noch 1 Tag", tone: "warning" });
  assert.deepEqual(aboEndState(new Date("2026-11-21T22:00:00Z"), now), { label: "endet heute", tone: "warning" });
  assert.deepEqual(aboEndState(new Date("2026-11-19T12:00:00Z"), now), { label: "abgelaufen", tone: "danger" });
});
