import { test } from "node:test";
import assert from "node:assert/strict";
import { SCAN_BASELINE_MAX_AGE_MS, scanLooksPartial, scanStep } from "./scanner-rules.js";

test("scanLooksPartial: weniger als die Haelfte der MACs des letzten guten Laufs", () => {
  assert.equal(scanLooksPartial(78, 78), false);
  assert.equal(scanLooksPartial(78, 39), false);
  assert.equal(scanLooksPartial(78, 38), true);
  // Nur die MACs, die Shellys selbst melden.
  assert.equal(scanLooksPartial(78, 13), true);
  assert.equal(scanLooksPartial(78, 0), true);
  // Mehr als vorher ist nie ein Teilscan.
  assert.equal(scanLooksPartial(10, 90), false);
});

test("scanLooksPartial: ohne Vergleichswert (erster Lauf nach dem Start) nie", () => {
  assert.equal(scanLooksPartial(0, 0), false);
  assert.equal(scanLooksPartial(0, 5), false);
  assert.equal(scanLooksPartial(Number.NaN, 5), false);
});

test("scanStep: ein Teilscan behaelt den Vergleichswert, ein guter Lauf ersetzt ihn", () => {
  const t0 = 1_000_000;
  const first = scanStep(null, 80, t0);
  assert.deepEqual(first, { partial: false, baseline: { withMac: 80, at: t0 } });
  const part = scanStep(first.baseline, 12, t0 + 1_800_000);
  assert.deepEqual(part, { partial: true, baseline: { withMac: 80, at: t0 } });
  // Zweimal hintereinander halb: weiterhin Teilscan gegen den guten Lauf.
  assert.equal(scanStep(part.baseline, 12, t0 + 3_600_000).partial, true);
  const good = scanStep(part.baseline, 75, t0 + 5_400_000);
  assert.deepEqual(good, { partial: false, baseline: { withMac: 75, at: t0 + 5_400_000 } });
});

test("scanStep: nach einem Tag ohne guten Lauf gilt der naechste wieder als gut", () => {
  const base = { withMac: 80, at: 0 };
  assert.equal(scanStep(base, 30, SCAN_BASELINE_MAX_AGE_MS - 1).partial, true);
  assert.deepEqual(scanStep(base, 30, SCAN_BASELINE_MAX_AGE_MS), {
    partial: false,
    baseline: { withMac: 30, at: SCAN_BASELINE_MAX_AGE_MS },
  });
});
