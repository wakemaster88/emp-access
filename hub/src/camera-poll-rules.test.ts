import { test } from "node:test";
import assert from "node:assert/strict";
import { EndRetry, clockDriftKey, endHoldFor, snapshotJobFor, type EventRef, type SnapshotGate } from "./camera-poll-rules.js";

const gate = (o: Partial<SnapshotGate> = {}): SnapshotGate => ({
  inFlight: false,
  now: 1_000_000,
  lastPipelineAt: 0,
  lastAutoAt: 0,
  throttleMs: 30_000,
  ...o,
});

test("Fahrzeug startet immer, auch mitten in einer Pipeline und direkt nach einem Bild", () => {
  assert.equal(snapshotJobFor("VEHICLE", gate({ inFlight: true, lastPipelineAt: 999_000, lastAutoAt: 999_000 })), "vehicle");
});

test("Person: ein reines Anzeige-Bild kurz davor sperrt die Gesichtserkennung nicht", () => {
  // Bewegung 2 s vorher hat ein Anzeige-Bild hochgeladen.
  assert.equal(snapshotJobFor("PERSON", gate({ lastAutoAt: 998_000 })), "person");
});

test("Person: nach einem Bild der Erkennungs-Pipeline gilt die Drossel weiter", () => {
  assert.equal(snapshotJobFor("PERSON", gate({ lastPipelineAt: 990_000 })), null);
  assert.equal(snapshotJobFor("PERSON", gate({ lastPipelineAt: 969_999 })), "person");
  assert.equal(snapshotJobFor("PERSON", gate({ inFlight: true })), null);
});

test("Bewegung und Tier: Anzeige-Bild hoechstens alle 30 s und nie direkt nach einer Pipeline", () => {
  assert.equal(snapshotJobFor("MOTION", gate()), "auto");
  assert.equal(snapshotJobFor("ANIMAL", gate({ lastAutoAt: 980_000 })), null);
  assert.equal(snapshotJobFor("MOTION", gate({ lastPipelineAt: 980_000 })), null);
  assert.equal(snapshotJobFor("MOTION", gate({ inFlight: true })), null);
  assert.equal(snapshotJobFor("MOTION", gate({ lastAutoAt: 969_999 })), "auto");
});

test("Nachlauf: nur Bewegung laeuft laenger nach, nie kuerzer als die anderen", () => {
  assert.equal(endHoldFor("MOTION", 6_000, 60_000), 60_000);
  assert.equal(endHoldFor("PERSON", 6_000, 60_000), 6_000);
  assert.equal(endHoldFor("VEHICLE", 6_000, 60_000), 6_000);
  assert.equal(endHoldFor("MOTION", 6_000, 0), 6_000);
});

test("Kamera-Uhren: wandernde Sekunden aendern die Aussage nicht, ein Sprung schon", () => {
  const a = clockDriftKey([
    { name: "A", offsetS: -32_374, ntp: false },
    { name: "B", offsetS: 14, ntp: true },
  ]);
  const b = clockDriftKey([
    { name: "B", offsetS: 19, ntp: true },
    { name: "A", offsetS: -32_391, ntp: false },
  ]);
  assert.equal(a, b);
  const c = clockDriftKey([
    { name: "A", offsetS: -2_083, ntp: false },
    { name: "B", offsetS: 14, ntp: true },
  ]);
  assert.notEqual(a, c);
});

const ev = (cameraId: number, type: string, phase: "start" | "end"): EventRef => ({ cameraId, type, phase });

test("Gescheiterte Meldung: ein Ende geht nur noch einmal mit, wenn die Cloud den Beginn kennt", () => {
  const r = new EndRetry();
  r.delivered([ev(7, "MOTION", "start")]);
  // Ende von Kamera 7 scheitert, dazu ein Beginn und ein Ende von Kamera 9,
  // deren Beginn die Cloud nie gesehen hat.
  const kept = r.failed([ev(7, "MOTION", "end"), ev(9, "PERSON", "start"), ev(9, "PERSON", "end")]);
  assert.deepEqual(kept, [ev(7, "MOTION", "end")]);
});

test("Gescheiterte Meldung: je Kamera und Art bleibt nur das erste Ende, auch ueber mehrere Versuche", () => {
  const r = new EndRetry();
  r.delivered([ev(7, "MOTION", "start")]);
  const first = r.failed([ev(7, "MOTION", "end"), ev(7, "MOTION", "start")]);
  assert.equal(first.length, 1);
  // Zweiter Versuch: das zurueckgelegte Ende vorn, dahinter ein Ende, dessen
  // Beginn im ersten Versuch entfiel.
  const second = r.failed([...first, ev(7, "MOTION", "end")]);
  assert.equal(second.length, 1);
  assert.equal(second[0], first[0]);
});

test("Angekommene Meldung: Ende traegt aus, ein neuer Beginn danach zaehlt wieder", () => {
  const r = new EndRetry();
  r.delivered([ev(7, "MOTION", "start"), ev(7, "MOTION", "end")]);
  assert.deepEqual(r.failed([ev(7, "MOTION", "end")]), []);
  r.delivered([ev(7, "MOTION", "end"), ev(7, "MOTION", "start")]);
  assert.equal(r.failed([ev(7, "MOTION", "end")]).length, 1);
  // Andere Art an derselben Kamera ist unabhaengig.
  assert.deepEqual(r.failed([ev(7, "PERSON", "end")]), []);
});
