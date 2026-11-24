import { test } from "node:test";
import assert from "node:assert/strict";
import { eventKey, orphanEndedAt, parseCloseOpen, planOrphanClose, recentActivityWhere } from "./camera-events";

const now = new Date("2026-11-24T12:00:00Z");

test("closeOpen: nur ganze Kamera-IDs, ohne Doppelte, Zeitpunkt nicht in der Zukunft", () => {
  const r = parseCloseOpen({ cameraIds: [9, "10", 9, 1.5, -3, "x"], before: "2026-11-24T11:59:00Z" }, now);
  assert.deepEqual(r?.cameraIds, [9, 10]);
  assert.equal(r?.before.toISOString(), "2026-11-24T11:59:00.000Z");
  assert.equal(parseCloseOpen({ cameraIds: [9], before: "2026-11-24T12:05:00Z" }, now), null);
  // Eine halbe Minute Uhrenabweichung ist erlaubt.
  assert.notEqual(parseCloseOpen({ cameraIds: [9], before: "2026-11-24T12:00:30Z" }, now), null);
});

test("closeOpen: unbrauchbare Angaben werden ignoriert", () => {
  assert.equal(parseCloseOpen(null, now), null);
  assert.equal(parseCloseOpen([], now), null);
  assert.equal(parseCloseOpen({ cameraIds: [], before: "2026-11-24T11:00:00Z" }, now), null);
  assert.equal(parseCloseOpen({ cameraIds: [1], before: "gestern" }, now), null);
  assert.equal(parseCloseOpen({ cameraIds: "1", before: "2026-11-24T11:00:00Z" }, now), null);
  assert.equal(parseCloseOpen({ cameraIds: [1] }, now), null);
});

test("closeOpen: hoechstens 200 Kameras", () => {
  const ids = Array.from({ length: 500 }, (_, i) => i + 1);
  assert.equal(parseCloseOpen({ cameraIds: ids, before: "2026-11-24T11:00:00Z" }, now)?.cameraIds.length, 200);
});

test("Laufendes Ereignis beim Hub-Neustart: endet am Neustart, wenn der Hub kurz davor noch meldete", () => {
  const before = new Date("2026-11-24T11:21:00Z");
  const started = new Date("2026-11-24T02:10:00Z"); // lief schon neun Stunden
  const seen = new Date("2026-11-24T11:20:20Z");
  assert.equal(orphanEndedAt(started, before, seen).toISOString(), before.toISOString());
  // Ohne Angabe zur Erreichbarkeit gilt der Neustart.
  assert.equal(orphanEndedAt(started, before, null).toISOString(), before.toISOString());
});

test("Laufendes Ereignis nach langem Stillstand: endet beim Ausfall, nicht erst beim Wiederanlauf", () => {
  const before = new Date("2026-11-24T11:21:00Z");
  const started = new Date("2026-11-24T06:00:00Z");
  const seen = new Date("2026-11-24T06:04:10Z"); // danach fiel der Strom aus
  assert.equal(orphanEndedAt(started, before, seen).toISOString(), "2026-11-24T06:05:10.000Z");
  // Letzte Meldung vor dem Beginn: nie ein Ende vor dem Beginn.
  const earlier = new Date("2026-11-24T05:30:00Z");
  assert.equal(orphanEndedAt(started, before, earlier).toISOString(), started.toISOString());
  // Beginn nach dem Neustart (Uhrenabweichung): ebenfalls nie davor.
  const later = new Date("2026-11-24T11:21:05Z");
  assert.equal(orphanEndedAt(later, before, seen).toISOString(), later.toISOString());
});

test("Offene Ereignisse nach dem Hub-Start: nur das juengste je Kamera und Art lief noch, Altlasten enden an ihrem Beginn", () => {
  const before = new Date("2026-11-24T11:21:00Z");
  const open = [
    { id: 30, cameraId: 7, type: "MOTION", startedAt: new Date("2026-11-24T11:19:30Z") },
    { id: 20, cameraId: 7, type: "PERSON", startedAt: new Date("2026-11-22T11:25:26Z") },
    { id: 10, cameraId: 7, type: "MOTION", startedAt: new Date("2026-11-20T12:45:39Z") },
    { id: 5, cameraId: 9, type: "MOTION", startedAt: new Date("2026-11-24T11:00:00Z") },
  ];
  // Kamera 7: die juengste Bewegung ist das offene Ereignis 30, die juengste
  // Person ein laengst beendetes (99). Kamera 9 fehlt in der Angabe.
  const newest = new Map([
    ["7:MOTION", 30],
    ["7:PERSON", 99],
  ]);
  const seen = new Map<number, Date | null>([[7, new Date("2026-11-24T11:20:40Z")]]);
  const plan = planOrphanClose(open, newest, before, seen);
  assert.deepEqual(
    plan.map((p) => [p.id, p.endedAt.toISOString()]),
    [
      [30, before.toISOString()],
      [20, "2026-11-22T11:25:26.000Z"],
      [10, "2026-11-20T12:45:39.000Z"],
      [5, "2026-11-24T11:00:00.000Z"],
    ],
  );
  assert.equal(eventKey({ cameraId: 7, type: "MOTION" }), "7:MOTION");
});

test("Ruhe im Raum: ein laufendes oder eben beendetes Ereignis zaehlt als Bewegung", () => {
  const since = new Date("2026-11-24T11:30:00Z");
  const w = recentActivityWhere(since, now);
  assert.equal(w.startedAt.gte.toISOString(), "2026-11-23T12:00:00.000Z");
  assert.deepEqual(w.OR, [{ startedAt: { gte: since } }, { endedAt: { gte: since } }, { endedAt: null }]);
  // Ruhezeit laenger als ein Tag: die Suche reicht bis dorthin zurueck.
  const longAgo = new Date("2026-11-22T00:00:00Z");
  assert.equal(recentActivityWhere(longAgo, now).startedAt.gte.toISOString(), longAgo.toISOString());
});
