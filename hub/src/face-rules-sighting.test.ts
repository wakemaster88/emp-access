import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIGHTING_MEMORY_MAX,
  rememberSighting,
  shouldStoreSighting,
  type SightingCandidate,
  type SightingUpload,
} from "./face-rules.js";
import { sightingRepeatMode, sightingSurveillance } from "./person-pipeline-rules.js";

const T = 1_000_000_000;
const MIN = 60_000;
const OPTS = { now: T, surveillance: false as boolean | null };

/** Einheitsvektor mit Kosinus `c` zu [1, 0]. */
const near = (c: number) => [c, Math.sqrt(1 - c * c)];

const upload = (o: Partial<SightingUpload> = {}): SightingUpload => ({
  at: T - 2 * MIN,
  personId: null,
  embedding: [1, 0],
  quality: 0.2,
  ...o,
});
const next = (o: Partial<SightingCandidate> = {}): SightingCandidate => ({
  at: T,
  personId: null,
  listType: null,
  embedding: [1, 0],
  quality: 0.2,
  ...o,
});

test("Dieselbe bekannte Person an derselben Kamera vor weniger als 5 min: Wiederholung", () => {
  const recent = [upload({ personId: 3, at: T - 2 * MIN })];
  const d = shouldStoreSighting(recent, next({ personId: 3, listType: "WHITELIST" }), OPTS);
  assert.deepEqual(d, { store: false, repeat: { known: true, gapS: 120, sim: null }, exempt: null });
  // Nach 5 min wieder eine neue Sichtung.
  assert.equal(shouldStoreSighting([upload({ personId: 3, at: T - 5 * MIN })], next({ personId: 3 }), OPTS).store, true);
  // Eine andere Person ist keine Wiederholung.
  assert.deepEqual(shouldStoreSighting(recent, next({ personId: 4 }), OPTS), { store: true, repeat: null, exempt: null });
  // Der jüngste Upload derselben Person zählt.
  const two = [upload({ personId: 3, at: T - 4 * MIN }), upload({ personId: 3, at: T - 30_000 })];
  assert.equal(shouldStoreSighting(two, next({ personId: 3 }), OPTS).repeat?.gapS, 30);
});

test("Unbekanntes Gesicht, das einem Upload ähnelt und nicht deutlich besser ist: Wiederholung", () => {
  const recent = [upload({ embedding: [1, 0], quality: 0.2 })];
  const d = shouldStoreSighting(recent, next({ embedding: near(0.6), quality: 0.25 }), OPTS);
  assert.equal(d.store, false);
  assert.deepEqual(d.repeat, { known: false, gapS: 120, sim: 0.6 });
  // Deutlich besser (mindestens 1,3-fach): neue Sichtung.
  assert.equal(shouldStoreSighting(recent, next({ embedding: near(0.6), quality: 0.27 }), OPTS).store, true);
  // Nicht ähnlich: neue Sichtung.
  assert.equal(shouldStoreSighting(recent, next({ embedding: near(0.3) }), OPTS).store, true);
  // Ähnlich einem erkannten Upload: ebenfalls Wiederholung (das Gesicht ist schon gespeichert).
  assert.equal(shouldStoreSighting([upload({ personId: 3 })], next({ embedding: near(0.7) }), OPTS).store, false);
});

test("Unbekannte Gesichter: genau 1,3-fache Güte ist deutlich besser, knapp darunter nicht", () => {
  const recent = [upload({ quality: 0.25 })];
  assert.equal(shouldStoreSighting(recent, next({ embedding: near(0.7), quality: 0.325 }), OPTS).repeat, null);
  assert.equal(shouldStoreSighting(recent, next({ embedding: near(0.7), quality: 0.3249 }), OPTS).store, false);
});

test("Unbekannte Gesichter: von mehreren ähnlichen Uploads zählt der ähnlichste", () => {
  const recent = [
    upload({ at: T - 3 * MIN, embedding: near(0.6) }),
    upload({ at: T - 2 * MIN, embedding: near(0.8) }),
    upload({ at: T - MIN, embedding: near(0.55) }),
  ];
  assert.deepEqual(shouldStoreSighting(recent, next(), OPTS).repeat, { known: false, gapS: 120, sim: 0.8 });
});

test("Unbekannte Gesichter: Kosinus ab 0,5", () => {
  const recent = [upload()];
  assert.equal(shouldStoreSighting(recent, next({ embedding: near(0.5) }), OPTS).store, false);
  assert.equal(shouldStoreSighting(recent, next({ embedding: near(0.49) }), OPTS).store, true);
  // Der Kosinus steht im Ergebnis: Die Zählung lässt sich später mit einer strengeren Schwelle auswerten.
  assert.equal(shouldStoreSighting(recent, next({ embedding: near(0.52) }), OPTS).repeat?.sim, 0.52);
});

test("Gemerkt werden nur Uploads der letzten 10 Minuten", () => {
  const old = [upload({ at: T - 10 * MIN })];
  assert.equal(shouldStoreSighting(old, next(), OPTS).store, true);
  assert.equal(shouldStoreSighting([upload({ at: T - 10 * MIN + 1 })], next(), OPTS).store, false);
  // Uhr zurückgestellt: ein Upload „aus der Zukunft“ zählt nicht.
  assert.equal(shouldStoreSighting([upload({ at: T + MIN })], next(), OPTS).store, true);
  assert.equal(shouldStoreSighting([], next(), OPTS).store, true);
});

test("Gesperrte Person: nie eine Wiederholung", () => {
  const recent = [upload({ personId: 9, at: T - 30_000 })];
  assert.deepEqual(shouldStoreSighting(recent, next({ personId: 9, listType: "BLACKLIST" }), OPTS), {
    store: true,
    repeat: { known: true, gapS: 30, sim: null },
    exempt: "gesperrt",
  });
});

test("Überwachungszeit oder Stunde unbekannt: nie eine Wiederholung", () => {
  const recent = [upload({ personId: 3 })];
  assert.equal(shouldStoreSighting(recent, next({ personId: 3 }), { ...OPTS, surveillance: true }).exempt, "Überwachung");
  assert.equal(shouldStoreSighting(recent, next({ personId: 3 }), { ...OPTS, surveillance: true }).store, true);
  assert.equal(shouldStoreSighting(recent, next({ personId: 3 }), { ...OPTS, surveillance: null }).store, true);
  assert.equal(shouldStoreSighting([upload()], next(), { ...OPTS, surveillance: true }).store, true);
});

test("Überwachungszeit 22 bis 7 Uhr Ortszeit nach der Uhr des Hubs", () => {
  assert.equal(sightingSurveillance(22), true);
  assert.equal(sightingSurveillance(23), true);
  assert.equal(sightingSurveillance(0), true);
  assert.equal(sightingSurveillance(6), true);
  assert.equal(sightingSurveillance(7), false);
  assert.equal(sightingSurveillance(14), false);
  assert.equal(sightingSurveillance(21), false);
  assert.equal(sightingSurveillance(Number.NaN), null);
});

test("Uploads merken: nur die letzten 10 Minuten, höchstens zehn je Kamera", () => {
  const list = Array.from({ length: 12 }, (_, i) => upload({ at: T - 5 * MIN + i * 1_000, personId: i }));
  const kept = rememberSighting(list, upload({ at: T, personId: 99 }), T);
  assert.equal(kept.length, SIGHTING_MEMORY_MAX);
  assert.equal(kept.at(-1)?.personId, 99);
  assert.deepEqual(rememberSighting([upload({ at: T - 11 * MIN })], upload({ at: T }), T).length, 1);
});

test("HUB_SIGHTING_REPEAT: count ist der Standard, skip und off auf Wunsch", () => {
  assert.equal(sightingRepeatMode(undefined), "count");
  assert.equal(sightingRepeatMode(""), "count");
  assert.equal(sightingRepeatMode("count"), "count");
  assert.equal(sightingRepeatMode("irgendwas"), "count");
  assert.equal(sightingRepeatMode(" Skip "), "skip");
  for (const v of ["off", "aus", "0", "false"]) assert.equal(sightingRepeatMode(v), "off", v);
});
