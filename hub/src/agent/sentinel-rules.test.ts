import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FACE_LEAD_MS,
  FACE_PRESENCE_LEAD_MS,
  FACE_WAIT_MS,
  SECOND_LOOK_DELAYS_MS,
  afterCalm,
  decidePerson,
  emptyLookOverruled,
  needsSecondLook,
  parsePersonLook,
  parseVerdict,
  secondLookResult,
  shouldInspect,
  trackerVeto,
  type SentinelContext,
} from "./sentinel-rules.js";

const ev = { kind: "camera", title: "PERSON erkannt", where: "Eingang" };
const base: SentinelContext = {
  closed: null,
  hour: 12,
  nightWindow: "22-6",
  always: false,
  lastInspectAt: undefined,
  now: 1_000_000,
  cooldownMs: 180_000,
  inspectionsLastHour: 0,
  maxPerHour: 20,
};

test("Im Betrieb keine Bewertung, geschlossen schon", () => {
  assert.equal(shouldInspect(ev, { ...base, closed: false }), false);
  assert.equal(shouldInspect(ev, { ...base, closed: true }), true);
});

test("Ohne Betriebszeit entscheidet das Nachtfenster", () => {
  assert.equal(shouldInspect(ev, { ...base, hour: 12 }), false);
  assert.equal(shouldInspect(ev, { ...base, hour: 23 }), true);
});

test("Abstand je Kamera und Stundenlimit", () => {
  const night = { ...base, closed: true };
  assert.equal(shouldInspect(ev, { ...night, lastInspectAt: base.now - 60_000 }), false);
  assert.equal(shouldInspect(ev, { ...night, lastInspectAt: base.now - 200_000 }), true);
  assert.equal(shouldInspect(ev, { ...night, inspectionsLastHour: 20 }), false);
});

test("Nur Beginn von Personen/Fahrzeugen zaehlt", () => {
  const night = { ...base, closed: true };
  assert.equal(shouldInspect({ ...ev, title: "PERSON beendet" }, night), false);
  assert.equal(shouldInspect({ ...ev, title: "MOTION erkannt" }, night), false);
  assert.equal(shouldInspect({ ...ev, title: "VEHICLE erkannt" }, night), true);
  assert.equal(shouldInspect({ kind: "person", title: "Person unbekannt", where: "x" }, night), false);
});

test("Urteil lesen", () => {
  assert.deepEqual(parseVerdict('{"auffaellig": true, "was": "Person am Zaun", "dringlichkeit": "hoch"}'), {
    auffaellig: true,
    was: "Person am Zaun",
    dringlichkeit: "hoch",
  });
  assert.equal(parseVerdict("kaputt").auffaellig, false);
  assert.equal(parseVerdict('Antwort: {"auffaellig":"ja","was":"x"}').auffaellig, true);
});

test("Zweiter Blick: nachts bei PERSON und „unauffällig“, sonst nicht", () => {
  const base = { isPerson: true, gateAuffaellig: false, hour: 23, nightWindow: "22-6" };
  assert.equal(needsSecondLook(base), true);
  assert.equal(needsSecondLook({ ...base, hour: 5 }), true);
  assert.equal(needsSecondLook({ ...base, hour: 6 }), false);
  assert.equal(needsSecondLook({ ...base, hour: 14 }), false);
  // Fahrzeug oder schon auffaellig: wie bisher ein Blick.
  assert.equal(needsSecondLook({ ...base, isPerson: false }), false);
  assert.equal(needsSecondLook({ ...base, gateAuffaellig: true }), false);
  // Stunde nicht lesbar: lieber nachsehen.
  assert.equal(needsSecondLook({ ...base, hour: Number.NaN }), true);
  assert.deepEqual(SECOND_LOOK_DELAYS_MS, [3_000, 8_000]);
});

test("Zweiter Blick: das erste Bild mit Person zählt, „leer“ nur wenn jedes Bild leer ist", () => {
  assert.equal(secondLookResult([0, 0, 0]), "leer");
  assert.equal(secondLookResult([1, 0, 0]), 0);
  assert.equal(secondLookResult([0, 0, 2]), 2);
  assert.equal(secondLookResult([0, 1, 3]), 1);
  // Ein Bild oder der Tracker fehlt: nicht bestaetigt.
  assert.equal(secondLookResult([0, null, 0]), "offen");
  assert.equal(secondLookResult([null, null, null]), "offen");
  assert.equal(secondLookResult([null, 1, null]), 1);
  assert.equal(secondLookResult([]), "offen");
});

test("Tracker-Gegencheck: kein Alarm nur ohne Person auf beiden Bildern und ohne Gesicht", () => {
  const T = 5_000_000;
  assert.equal(FACE_PRESENCE_LEAD_MS, 90_000);
  assert.equal(FACE_WAIT_MS, 30_000);
  // Leer, leer, kein Gesicht: Veto wie bisher.
  assert.equal(trackerVeto({ first: 0, second: 0, faceSeenAt: null, triggerAt: T }), true);
  // Gesicht 7 s, 20 s oder 30 s vor dem Ausloeser oder danach: kein Veto.
  assert.equal(trackerVeto({ first: 0, second: 0, faceSeenAt: T - 7_000, triggerAt: T }), false);
  assert.equal(trackerVeto({ first: 0, second: 0, faceSeenAt: T - 20_000, triggerAt: T }), false);
  assert.equal(trackerVeto({ first: 0, second: 0, faceSeenAt: T - 30_000, triggerAt: T }), false);
  assert.equal(trackerVeto({ first: 0, second: 0, faceSeenAt: T - 90_000, triggerAt: T }), false);
  assert.equal(trackerVeto({ first: 0, second: 0, faceSeenAt: T + 12_000, triggerAt: T }), false);
  // Das Fenster fuer die Entlastung durch ein bekanntes Gesicht (10 s) gilt hier nicht.
  assert.ok(FACE_PRESENCE_LEAD_MS > FACE_LEAD_MS);
  // Gesicht mehr als 90 s vorher: zaehlt nicht.
  assert.equal(trackerVeto({ first: 0, second: 0, faceSeenAt: T - 91_000, triggerAt: T }), true);
  // Tracker nicht erreichbar oder sieht jemanden: kein Veto wie bisher.
  assert.equal(trackerVeto({ first: 0, second: null, faceSeenAt: null, triggerAt: T }), false);
  assert.equal(trackerVeto({ first: null, second: 0, faceSeenAt: null, triggerAt: T }), false);
  assert.equal(trackerVeto({ first: 1, second: 0, faceSeenAt: null, triggerAt: T }), false);
});

test("Nahaufnahme ohne Person: entwarnt nicht gegen Gesicht oder (nachts) Tracker", () => {
  const T = 5_000_000;
  const base = { trackerCount: null as number | null, faceSeenAt: null as number | null, triggerAt: T, hour: 14, nightWindow: "22-6" };
  assert.equal(emptyLookOverruled(base), null);
  assert.equal(emptyLookOverruled({ ...base, faceSeenAt: T + 4_000 }), "gesicht");
  assert.equal(emptyLookOverruled({ ...base, faceSeenAt: T - 20_000 }), "gesicht");
  assert.equal(emptyLookOverruled({ ...base, faceSeenAt: T - 90_000 }), "gesicht");
  assert.equal(emptyLookOverruled({ ...base, faceSeenAt: T - 91_000 }), null);
  assert.equal(emptyLookOverruled({ ...base, trackerCount: 1 }), null);
  assert.equal(emptyLookOverruled({ ...base, trackerCount: 1, hour: 23 }), "tracker");
  assert.equal(emptyLookOverruled({ ...base, trackerCount: 0, hour: 23 }), null);

  const look = parsePersonLook('{"personen":0,"was":"Keine Person zu sehen"}');
  const plain = decidePerson({ face: null, staff: [], look, hour: 23 });
  assert.equal(plain.alarm, false);
  assert.equal(plain.basis, "leer");
  const withFace = decidePerson({ face: null, staff: [], look, hour: 23, presence: "gesicht" });
  assert.equal(withFace.alarm, true);
  assert.match(withFace.reason, /Gesichtserkennung hat aber ein Gesicht gefunden/);
  const withTracker = decidePerson({ face: null, staff: [], look, hour: 23, presence: "tracker" });
  assert.equal(withTracker.alarm, true);
  assert.match(withTracker.reason, /Tracker sieht aber jemanden/);
});

test("„Unauffällig“ ist bei einer Person nicht endgültig, wenn die Gesichtserkennung ein Gesicht gemeldet hat", () => {
  const T = 5_000_000;
  const base = { isPerson: true, secondLook: "leer" as const, faceSeenAt: null as number | null, triggerAt: T };
  // Nachts: drei leere Bilder und kein Gesicht – es bleibt bei „unauffällig“.
  assert.deepEqual(afterCalm(base), { then: "unauffaellig" });
  // Gesicht 5 s nach dem Ausloeser: weiter bewerten.
  assert.deepEqual(afterCalm({ ...base, faceSeenAt: T + 5_000 }), { then: "gesicht" });
  // Am Tag ohne zweiten Blick ebenso, auch mit einem Gesicht 20 s vorher.
  assert.deepEqual(afterCalm({ ...base, secondLook: null, faceSeenAt: T - 20_000 }), { then: "gesicht" });
  assert.deepEqual(afterCalm({ ...base, secondLook: null, faceSeenAt: T - 91_000 }), { then: "unauffaellig" });
  assert.deepEqual(afterCalm({ ...base, secondLook: null }), { then: "unauffaellig" });
  // Der Tracker sieht jemanden: weiter mit seinem Bild, ob mit Gesicht oder ohne.
  assert.deepEqual(afterCalm({ ...base, secondLook: 2 }), { then: "tracker", shot: 2 });
  assert.deepEqual(afterCalm({ ...base, secondLook: 1, faceSeenAt: T }), { then: "tracker", shot: 1 });
  // Tracker konnte nicht jedes Bild pruefen: weiter, mit Gesicht als Grund, wenn eins da ist.
  assert.deepEqual(afterCalm({ ...base, secondLook: "offen" }), { then: "offen" });
  assert.deepEqual(afterCalm({ ...base, secondLook: "offen", faceSeenAt: T + 1_000 }), { then: "gesicht" });
  // Fahrzeug: ein Gesicht aendert am „unauffällig“ nichts.
  assert.deepEqual(afterCalm({ ...base, isPerson: false, secondLook: null, faceSeenAt: T }), { then: "unauffaellig" });
});
