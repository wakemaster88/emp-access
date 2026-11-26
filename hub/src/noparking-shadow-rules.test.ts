import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MIN_AREA, DEFAULT_MIN_CONF, type NoParkBox } from "./noparking-rules.js";
import {
  SHADOW_EVERY,
  SHADOW_IMGSZ,
  SHADOW_MARGIN,
  shadowCompare,
  shadowDue,
  shadowEnabled,
  usedRoi,
  zoneRoi,
} from "./noparking-shadow-rules.js";

/** Fläche am Eingang (Schotterstreifen), Umriss wie im Dashboard gezogen. */
const ZONE = [
  { x: 0.535, y: 0.2 },
  { x: 0.7, y: 0.145 },
  { x: 0.94, y: 0.3 },
  { x: 0.9, y: 0.628 },
  { x: 0.6, y: 0.55 },
];
const FILTER = { minConf: DEFAULT_MIN_CONF, minArea: DEFAULT_MIN_AREA };

/** Pkw mit rund 0,7 % Bildfläche, Fußpunkt in der Fläche. */
const car = (conf: number, dx = 0): NoParkBox => ({ cls: 2, conf, x: 0.7 + dx, y: 0.35, w: 0.12, h: 0.06 });

test("Standard: Vergleich an, jeder 10. Durchlauf, 15 % Rand, Auflösung 1280", () => {
  assert.equal(SHADOW_EVERY, 10);
  assert.equal(SHADOW_MARGIN, 0.15);
  assert.equal(SHADOW_IMGSZ, 1280);
  assert.equal(shadowEnabled(undefined), true);
  assert.equal(shadowEnabled(""), true);
  assert.equal(shadowEnabled("1"), true);
  for (const off of ["0", " 0 ", "off", "aus", "false", "nein", "no", "OFF"]) assert.equal(shadowEnabled(off), false, off);
});

test("fällig: jeder 10. Durchlauf und jeder mit Kandidat", () => {
  const due = Array.from({ length: 30 }, (_, i) => i + 1).filter((run) => shadowDue(run, false));
  assert.deepEqual(due, [10, 20, 30]);
  assert.equal(shadowDue(3, true), true);
  assert.equal(shadowDue(0, false), false);
  assert.equal(shadowDue(5, false, 0), false);
});

test("Ausschnitt: Hüllrechteck der Fläche plus 15 % je Seite, im Bild begrenzt", () => {
  const r = zoneRoi(ZONE)!;
  const w = 0.94 - 0.535;
  const h = 0.628 - 0.145;
  assert.ok(Math.abs(r.x - (0.535 - 0.15 * w)) < 1e-9);
  assert.ok(Math.abs(r.y - (0.145 - 0.15 * h)) < 1e-9);
  // Rechts stößt der Rand an die Bildkante.
  assert.ok(Math.abs(r.x + r.w - 1) < 1e-9);
  assert.ok(Math.abs(r.y + r.h - (0.628 + 0.15 * h)) < 1e-9);
  assert.equal(zoneRoi([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]), null);
  assert.equal(zoneRoi([{ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.2 }, { x: 0.1, y: 0.3 }]), null);
  const all = zoneRoi([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])!;
  assert.deepEqual(all, { x: 0, y: 0, w: 1, h: 1 });
});

test("älterer Tracker ohne roi in der Antwort: nichts zu vergleichen", () => {
  assert.equal(usedRoi({ vehicles: [] }), false);
  assert.equal(usedRoi({ vehicles: [], roi: "0.4,0.1,0.6,0.6" }), false);
  assert.equal(usedRoi({ vehicles: [], roi: [0.4, 0.1, 0.6] }), false);
  assert.equal(usedRoi(null), false);
  assert.equal(usedRoi({ vehicles: [], roi: [0.4, 0.1, 0.6, 0.6], imgsz: 1280 }), true);
});

test("Vergleich: gleich, mehr, weniger – mit denselben Regeln wie die Meldung", () => {
  const same = shadowCompare([car(0.45)], [car(0.62)], ZONE, FILTER);
  assert.equal(same.outcome, "same");
  assert.deepEqual(same.full, { boxes: 1, confSum: 0.45 });
  assert.deepEqual(same.roi, { boxes: 1, confSum: 0.62 });

  // Auf dem ganzen Bild unter der Schwelle, im Ausschnitt sicher erkannt.
  const more = shadowCompare([car(0.3)], [car(0.55)], ZONE, FILTER);
  assert.equal(more.outcome, "more");
  assert.equal(more.full.boxes, 0);

  const less = shadowCompare([car(0.5), car(0.5, -0.14)], [car(0.5)], ZONE, FILTER);
  assert.equal(less.outcome, "less");
  assert.equal(less.full.boxes, 2);
  assert.equal(less.roi.boxes, 1);

  // Doppelerkennung (Auto und Lastwagen auf derselben Box) zählt einmal.
  const dup = shadowCompare([car(0.5)], [car(0.5), { ...car(0.44), cls: 7 }], ZONE, FILTER);
  assert.equal(dup.outcome, "same");

  // Außerhalb der Fläche oder zu klein zählt in keinem Weg.
  const outside: NoParkBox = { cls: 2, conf: 0.9, x: 0.1, y: 0.7, w: 0.12, h: 0.06 };
  const tiny: NoParkBox = { cls: 2, conf: 0.9, x: 0.75, y: 0.4, w: 0.02, h: 0.02 };
  assert.equal(shadowCompare([], [outside, tiny], ZONE, FILTER).outcome, "same");
});
