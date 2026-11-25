import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSON_GONE_MS, nextLastActiveAt, pipelineShouldStop, sightingAction, takeOpticalFace } from "./person-pipeline-rules.js";
import type { FaceShot } from "./face-rules.js";

const T0 = 1_000_000;

/**
 * Die Pipeline, wie cameras.ts sie faehrt: vor jedem Versuch der rohe Zustand
 * der Kamera, `seenAt` = zuletzt gesehen beim Start (rohe Flanke: der Start
 * selbst), `poll` = was die regulaere Abfrage bis dahin zuletzt gesehen hat
 * (Zeit ab T0). Liefert, vor welchem Versuch sie endet (null = alle gemacht).
 */
function stopsBefore(polls: Array<{ at: number; person: boolean; poll?: number }>, seenAt = T0): number | null {
  let lastActiveAt = seenAt;
  for (let i = 0; i < polls.length; i++) {
    const now = T0 + polls[i].at;
    const rawActive = polls[i].person;
    const poll = polls[i].poll;
    lastActiveAt = nextLastActiveAt({ rawActive, now, prev: lastActiveAt, seenByPoll: poll == null ? undefined : T0 + poll });
    if (pipelineShouldStop({ rawActive, lastActiveAt, now })) return i + 1;
  }
  return null;
}

test("Signal gesetzt: der Versuch läuft", () => {
  assert.equal(pipelineShouldStop({ rawActive: true, lastActiveAt: T0, now: T0 }), false);
  // Auch wenn es davor lange aus war: jetzt ist die Person da.
  assert.equal(pipelineShouldStop({ rawActive: true, lastActiveAt: T0 - 60_000, now: T0 }), false);
});

test("Ein Aussetzer des Signals beendet die Serie nicht", () => {
  assert.equal(pipelineShouldStop({ rawActive: false, lastActiveAt: T0, now: T0 + 100 }), false);
  assert.equal(pipelineShouldStop({ rawActive: false, lastActiveAt: T0, now: T0 + 2_400 }), false);
  assert.equal(pipelineShouldStop({ rawActive: false, lastActiveAt: T0, now: T0 + PERSON_GONE_MS - 1 }), false);
});

test("Seit 4 s nicht mehr gemeldet: die Person ist gegangen", () => {
  assert.equal(PERSON_GONE_MS, 4_000);
  assert.equal(pipelineShouldStop({ rawActive: false, lastActiveAt: T0, now: T0 + PERSON_GONE_MS }), true);
  assert.equal(pipelineShouldStop({ rawActive: false, lastActiveAt: T0, now: T0 + 30_000 }), true);
});

test("Nach der rohen Flanke entsteht das erste Bild immer: die Flanke gilt als gesehen", () => {
  // Die Flanke hat die Pipeline gestartet, die Abfrage direkt danach zeigt schon nichts mehr.
  assert.equal(stopsBefore([{ at: 80, person: false }]), null);
});

test("Flackerndes Signal: alle vier Versuche laufen", () => {
  const polls = [
    { at: 80, person: true },
    { at: 2_500, person: false },
    { at: 4_900, person: true },
    { at: 7_300, person: false },
  ];
  assert.equal(stopsBefore(polls), null);
});

test("Kurzer Durchgang: noch ein Versuch nach dem letzten Signal, dann Schluss", () => {
  const polls = [
    { at: 80, person: true },
    { at: 2_500, person: false },
    { at: 4_900, person: false },
    { at: 7_300, person: false },
  ];
  assert.equal(stopsBefore(polls), 3);
});

test("Lauf nach einem Fahrzeug-Burst: zählt ab der letzten Abfrage mit Person, nicht ab dem Start", () => {
  // Zuletzt vor 10 s gesehen, die erste Abfrage zeigt nichts: kein Bild mehr.
  assert.equal(stopsBefore([{ at: 80, person: false }], T0 - 10_000), 1);
  // Die Person ist noch da: der Lauf macht seine Versuche.
  assert.equal(stopsBefore([{ at: 80, person: true }], T0 - 10_000), null);
  // Vor 2 s noch gesehen: ein Aussetzer, der Versuch läuft trotzdem.
  assert.equal(stopsBefore([{ at: 80, person: false }], T0 - 2_000), null);
});

test("Die reguläre Abfrage sieht die Person, die Abfrage der Pipeline nicht: der Versuch läuft", () => {
  // Die Pipeline sieht seit dem Start nichts, die reguläre Abfrage meldete die Person vor 1 s.
  const polls = [
    { at: 80, person: true },
    { at: 2_500, person: false, poll: 2_000 },
    { at: 4_900, person: false, poll: 4_000 },
    { at: 7_300, person: false, poll: 6_500 },
  ];
  assert.equal(stopsBefore(polls), null);
  assert.equal(nextLastActiveAt({ rawActive: false, now: T0 + 5_000, prev: T0, seenByPoll: T0 + 4_000 }), T0 + 4_000);
  // Ein älterer Wert der Abfrage setzt nichts zurück.
  assert.equal(nextLastActiveAt({ rawActive: false, now: T0 + 5_000, prev: T0 + 3_000, seenByPoll: T0 + 1_000 }), T0 + 3_000);
  // Ohne Wert der Abfrage gilt der bisherige Stand, mit Person jetzt.
  assert.equal(nextLastActiveAt({ rawActive: false, now: T0 + 5_000, prev: T0 + 3_000, seenByPoll: undefined }), T0 + 3_000);
  assert.equal(nextLastActiveAt({ rawActive: true, now: T0 + 5_000, prev: T0, seenByPoll: T0 + 1_000 }), T0 + 5_000);
});

test("Wiederholungen: mit count und off wird jede Sichtung hochgeladen, nur skip lässt sie weg", () => {
  for (const store of [true, false]) {
    assert.equal(sightingAction("count", { store }), "upload");
    assert.equal(sightingAction("off", { store }), "upload");
  }
  assert.equal(sightingAction("skip", { store: true }), "upload");
  assert.equal(sightingAction("skip", { store: false }), "skip");
});

test("Die Uhr springt zurück: kein Abbruch aus einer negativen Dauer", () => {
  assert.equal(pipelineShouldStop({ rawActive: false, lastActiveAt: T0, now: T0 - 5_000 }), false);
});

const shot = (f: Partial<FaceShot>): FaceShot => ({ embedding: [1, 0], detScore: 0.7, upscaled: true, ...f });

test("Optischer Zoom: neues Gesicht nur mit Treffer oder höherer Güte", () => {
  const before = shot({ size: 30, frontal: 0.8, sharp: 0.6 });
  // Treffer geht immer vor, auch bei deutlich schlechterer Güte.
  const worse = shot({ size: 16, detScore: 0.5, frontal: 0.2, sharp: 0.2 });
  assert.equal(takeOpticalFace({ matched: false, before, after: worse }), false);
  assert.equal(takeOpticalFace({ matched: true, before, after: worse }), true);
  // Ohne bisheriges Gesicht gilt jedes neue.
  assert.equal(takeOpticalFace({ matched: false, before: null, after: shot({ size: 20 }) }), true);
  // Größer und direkt erkannt: besser.
  assert.equal(takeOpticalFace({ matched: false, before, after: shot({ size: 70, detScore: 0.8, upscaled: false }) }), true);
  // Kleiner und unsicherer: das bisherige bleibt.
  assert.equal(takeOpticalFace({ matched: false, before, after: shot({ size: 24, detScore: 0.5, frontal: 0.8, sharp: 0.6 }) }), false);
  // Gleich gut: das bisherige (gemittelte) bleibt.
  assert.equal(takeOpticalFace({ matched: false, before, after: { ...before } }), false);
});
