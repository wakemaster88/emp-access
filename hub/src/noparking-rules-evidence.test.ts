import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_FACTOR, EVIDENCE_MIN_WIDTH_PX, evidenceRect, unionBox, type NormRect } from "./noparking-rules.js";

/*
 * Zusage an den Betreiber: Zusätzlich käme ein Ausschnitt in voller
 * Auflösung, in der Historie und in Telegram. Box mal 2, mindestens 800
 * Pixel breit, am Bildrand begrenzt.
 */

const W = 3840;
const H = 2160;
const px = (r: NormRect | null) =>
  r && { x: Math.round(r.x * W), y: Math.round(r.y * H), w: Math.round(r.w * W), h: Math.round(r.h * H) };

test("Konstanten: Box mal 2, mindestens 800 Pixel", () => {
  assert.equal(EVIDENCE_FACTOR, 2);
  assert.equal(EVIDENCE_MIN_WIDTH_PX, 800);
});

test("evidenceRect: Pkw in der Bildmitte – doppelte Box um dieselbe Mitte", () => {
  // Box 0,12 × 0,06 bei 4K: 461 × 130 px, doppelt 922 × 259 px.
  const r = evidenceRect({ x: 0.54, y: 0.4, w: 0.12, h: 0.06 }, 2, W, H);
  assert.deepEqual(px(r), { x: 1843, y: 799, w: 922, h: 259 });
  // Mitte bleibt.
  assert.ok(Math.abs(r!.x + r!.w / 2 - 0.6) < 1e-9);
  assert.ok(Math.abs(r!.y + r!.h / 2 - 0.43) < 1e-9);
});

test("evidenceRect: kleine Box – mindestens 800 px breit, Höhe im selben Verhältnis", () => {
  // 0,05 × 0,04: doppelt 384 × 173 px, auf 800 px Breite: 800 × 360 px.
  const r = px(evidenceRect({ x: 0.3, y: 0.3, w: 0.05, h: 0.04 }, 2, W, H));
  assert.equal(r!.w, 800);
  assert.equal(r!.h, 360);
});

test("evidenceRect: am Bildrand nach innen verschoben, nie größer als das Bild", () => {
  // 0,1 × 0,1 unten rechts: doppelt 768 × 432 px, auf 800 × 450 px, an der Ecke anliegend.
  const right = px(evidenceRect({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 2, W, H));
  assert.deepEqual(right, { x: W - 800, y: H - 450, w: 800, h: 450 });
  const left = evidenceRect({ x: 0, y: 0, w: 0.1, h: 0.1 }, 2, W, H)!;
  assert.equal(left.x, 0);
  assert.equal(left.y, 0);
  const huge = evidenceRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 2, W, H)!;
  assert.deepEqual(huge, { x: 0, y: 0, w: 1, h: 1 });
  // Bild schmaler als 800 px: ganzes Bild in der Breite.
  const small = evidenceRect({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, 2, 640, 360)!;
  assert.equal(small.x, 0);
  assert.equal(small.w, 1);
  for (const r of [right, px(left), px(huge), px(small)]) {
    assert.ok(r!.x >= 0 && r!.y >= 0 && r!.x + r!.w <= W && r!.y + r!.h <= H);
  }
});

test("evidenceRect: unbrauchbare Angaben – null", () => {
  assert.equal(evidenceRect({ x: 0.1, y: 0.1, w: 0, h: 0.1 }, 2, W, H), null);
  assert.equal(evidenceRect({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, 2, 0, H), null);
  assert.equal(evidenceRect({ x: Number.NaN, y: 0.1, w: 0.1, h: 0.1 }, 2, W, H), null);
  assert.equal(evidenceRect({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, 0, W, H), null);
});

test("unionBox: mehrere Fahrzeuge einer Meldung in einem Ausschnitt", () => {
  assert.equal(unionBox([]), null);
  const u = unionBox([
    { x: 0.5, y: 0.2, w: 0.1, h: 0.05 },
    { x: 0.7, y: 0.25, w: 0.12, h: 0.06 },
  ])!;
  assert.ok(Math.abs(u.x - 0.5) < 1e-9 && Math.abs(u.y - 0.2) < 1e-9);
  assert.ok(Math.abs(u.w - 0.32) < 1e-9 && Math.abs(u.h - 0.11) < 1e-9);
});
