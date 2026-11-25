import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityAt,
  eventKey,
  isRunning,
  lastKnownAlive,
  latestActivityByRoom,
  missingRunning,
  orphanEndedAt,
  parseCloseOpen,
  parseRunning,
  planOrphanClose,
  recentActivityWhere,
  shownAsRunning,
  shownEndedAt,
  staleOpen,
  withOpenEvents,
} from "./camera-events";

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
  // Offen zaehlt, solange der Hub die Kamera im Zeitraum noch gemeldet hat:
  // Faellt sie um 11:35 aus, gilt der Raum bei 30 min Ruhezeit ab 12:05 als ruhig.
  assert.deepEqual(w.OR, [
    { startedAt: { gte: since } },
    { endedAt: { gte: since } },
    { endedAt: null, camera: { lastSeenAt: { gte: since } } },
  ]);
  // Sehr kurzer Zeitraum (1 min): Der Hub meldet nur einmal je Minute, ein
  // laufendes Ereignis darf nicht herausfallen. Grenze dann 5 Minuten.
  const short = recentActivityWhere(new Date("2026-11-24T11:59:00Z"), now);
  assert.deepEqual(short.OR[2], { endedAt: null, camera: { lastSeenAt: { gte: new Date("2026-11-24T11:55:00Z") } } });
  // Ruhezeit laenger als ein Tag: die Suche reicht bis dorthin zurueck.
  const longAgo = new Date("2026-11-22T00:00:00Z");
  assert.equal(recentActivityWhere(longAgo, now).startedAt.gte.toISOString(), longAgo.toISOString());
});

test("Auskunft ueber einen Zeitraum: offene Ereignisse behalten ihren Platz, jedes steht einmal", () => {
  const item = (id: number, startedAt: string, endedAt: string | null = null) => ({
    id,
    startedAt: new Date(startedAt),
    endedAt: endedAt ? new Date(endedAt) : null,
  });
  // Die vier juengsten nach Beginn, so weit reicht die Abfrage. 14 ist noch offen.
  const recent = [
    item(14, "2026-11-24T11:58:00Z"),
    item(13, "2026-11-24T11:40:00Z", "2026-11-24T11:41:00Z"),
    item(12, "2026-11-24T11:30:00Z", "2026-11-24T11:30:20Z"),
    item(11, "2026-11-24T11:20:00Z", "2026-11-24T11:21:00Z"),
  ];
  // Offen: 14 steht auch oben, 3 laeuft seit 08:03 und begann vor allen anderen.
  const open = [item(14, "2026-11-24T11:58:00Z"), item(3, "2026-11-24T08:03:00Z")];
  // Vier Plaetze: Das aelteste beendete (11) weicht dem laufenden (3).
  assert.deepEqual(
    withOpenEvents(recent, open, 4).map((e) => e.id),
    [14, 13, 12, 3],
  );
  // Platz genug: alle, nach Beginn absteigend.
  assert.deepEqual(
    withOpenEvents(recent, open, 200).map((e) => e.id),
    [14, 13, 12, 11, 3],
  );
  // Nichts offen: Die Liste bleibt, wie sie ist.
  assert.deepEqual(
    withOpenEvents(recent, [], 4).map((e) => e.id),
    [14, 13, 12, 11],
  );
  assert.deepEqual(withOpenEvents([], [], 4), []);
  // Mehr offene als Plaetze: Die zuerst genannten bleiben.
  assert.deepEqual(
    withOpenEvents(recent, open, 1).map((e) => e.id),
    [14],
  );
  // Gleicher Beginn: Die hoehere ID steht vorn.
  assert.deepEqual(
    withOpenEvents([item(20, "2026-11-24T11:00:00Z"), item(21, "2026-11-24T11:00:00Z")], [], 5).map((e) => e.id),
    [21, 20],
  );
  // Die Eingaben bleiben unveraendert.
  assert.deepEqual(
    recent.map((e) => e.id),
    [14, 13, 12, 11],
  );
});

test("closeOpen: Lebenszeichen des alten Prozesses nur von vor dem Start", () => {
  const before = "2026-11-24T11:21:00Z";
  const ok = parseCloseOpen({ cameraIds: [7], before, lastAlive: "2026-11-24T06:04:30Z" }, now);
  assert.equal(ok?.lastAlive?.toISOString(), "2026-11-24T06:04:30.000Z");
  // Nach dem Start, unlesbar oder nicht angegeben: keine Angabe.
  assert.equal(parseCloseOpen({ cameraIds: [7], before, lastAlive: "2026-11-24T11:21:05Z" }, now)?.lastAlive, null);
  assert.equal(parseCloseOpen({ cameraIds: [7], before, lastAlive: "gestern" }, now)?.lastAlive, null);
  assert.equal(parseCloseOpen({ cameraIds: [7], before }, now)?.lastAlive, null);
});

test("Letzter sicherer Zeitpunkt: Kamera-Meldung nur von vor dem Start, sonst das Lebenszeichen", () => {
  const before = new Date("2026-11-24T11:21:00Z");
  const alive = new Date("2026-11-24T06:04:30Z");
  // Der neue Prozess hat die Kamera schon gemeldet (Bild, Tor): zaehlt nicht.
  const byNewProcess = new Date("2026-11-24T11:21:02Z");
  assert.equal(lastKnownAlive(before, byNewProcess, alive)?.toISOString(), alive.toISOString());
  assert.equal(lastKnownAlive(before, byNewProcess, null), null);
  // Kamera fiel vor dem Hub aus: ihr Zeitpunkt gilt.
  const camDown = new Date("2026-11-24T05:50:00Z");
  assert.equal(lastKnownAlive(before, camDown, alive)?.toISOString(), camDown.toISOString());
  // Aelterer Hub ohne Lebenszeichen: wie bisher die Kamera-Meldung.
  assert.equal(lastKnownAlive(before, camDown, null)?.toISOString(), camDown.toISOString());
  assert.equal(lastKnownAlive(before, null, null), null);
});

test("Langer Stillstand: das Ereignis endet beim Ausfall, auch wenn der neue Prozess die Kamera schon gemeldet hat", () => {
  const before = new Date("2026-11-24T07:30:00Z");
  const open = [{ id: 1, cameraId: 3, type: "MOTION", startedAt: new Date("2026-11-24T01:59:00Z") }];
  const newest = new Map([["3:MOTION", 1]]);
  const seen = new Map<number, Date | null>([[3, new Date("2026-11-24T07:30:03Z")]]);
  const alive = new Date("2026-11-24T02:00:10Z");
  assert.equal(planOrphanClose(open, newest, before, seen, alive)[0].endedAt.toISOString(), "2026-11-24T02:01:10.000Z");
  // Ohne Lebenszeichen bleibt nur der Neustart.
  assert.equal(planOrphanClose(open, newest, before, seen)[0].endedAt.toISOString(), before.toISOString());
});

const TYPES = ["MOTION", "PERSON", "VEHICLE"];

test("Laufende Ereignisse: nur brauchbare Angaben, je Kamera und Art eine", () => {
  const r = parseRunning(
    [
      { cameraId: 7, type: "MOTION", at: "2026-11-24T09:00:00Z" },
      { cameraId: "8", type: "PERSON", at: "2026-11-24T11:59:30Z" },
      { cameraId: 7, type: "MOTION", at: "2026-11-24T10:00:00Z" }, // doppelt
      { cameraId: 7, type: "UFO", at: "2026-11-24T09:00:00Z" }, // unbekannte Art
      { cameraId: 1.5, type: "MOTION", at: "2026-11-24T09:00:00Z" },
      { cameraId: 9, type: "MOTION", at: "2026-11-24T12:05:00Z" }, // Zukunft
      { cameraId: 9, type: "MOTION", at: "2026-11-22T09:00:00Z" }, // aelter als ein Tag
      { cameraId: 9, type: "VEHICLE", at: "irgendwann" },
      { cameraId: 9, type: "VEHICLE" },
      null,
      "x",
    ],
    now,
    TYPES,
  );
  assert.deepEqual(
    r?.map((e) => [e.cameraId, e.type, e.startedAt.toISOString()]),
    [
      [7, "MOTION", "2026-11-24T09:00:00.000Z"],
      [8, "PERSON", "2026-11-24T11:59:30.000Z"],
    ],
  );
  // Keine Angabe (aelterer Hub) ist etwas anderes als eine leere Liste.
  assert.equal(parseRunning(undefined, now, TYPES), null);
  assert.equal(parseRunning({ cameraId: 7 }, now, TYPES), null);
  assert.deepEqual(parseRunning([], now, TYPES), []);
});

test("Laufende Ereignisse: nachgetragen wird nur, was die Cloud nicht offen hat", () => {
  const running = parseRunning(
    [
      { cameraId: 7, type: "MOTION", at: "2026-11-24T09:00:00Z" },
      { cameraId: 7, type: "PERSON", at: "2026-11-24T11:58:00Z" },
      { cameraId: 8, type: "MOTION", at: "2026-11-24T11:50:00Z" },
    ],
    now,
    TYPES,
  )!;
  const missing = missingRunning(running, new Set(["7:MOTION"]));
  assert.deepEqual(missing.map(eventKey), ["7:PERSON", "8:MOTION"]);
  assert.deepEqual(missingRunning(running, new Set(["7:MOTION", "7:PERSON", "8:MOTION"])), []);
});

test("Laeuft noch: offen, hoechstens einen Tag alt, Kamera frisch gemeldet", () => {
  const open = { startedAt: new Date("2026-11-24T08:03:00Z"), endedAt: null };
  const fresh = new Date("2026-11-24T11:59:10Z");
  assert.equal(isRunning(open, fresh, now), true);
  // Kamera seit 20 Minuten nicht gemeldet oder nie: nicht mehr laufend.
  assert.equal(isRunning(open, new Date("2026-11-24T11:40:00Z"), now), false);
  assert.equal(isRunning(open, null, now), false);
  // Beendet oder aelter als ein Tag.
  assert.equal(isRunning({ ...open, endedAt: new Date("2026-11-24T11:10:00Z") }, fresh, now), false);
  assert.equal(isRunning({ startedAt: new Date("2026-11-23T11:00:00Z"), endedAt: null }, fresh, now), false);

  assert.equal(activityAt(open, fresh, now).toISOString(), now.toISOString());
  assert.equal(
    activityAt({ ...open, endedAt: new Date("2026-11-24T11:10:00Z") }, fresh, now).toISOString(),
    "2026-11-24T11:10:00.000Z",
  );
  // Offen, aber Kamera nie gemeldet: Es bleibt der Beginn.
  assert.equal(activityAt(open, null, now).toISOString(), "2026-11-24T08:03:00.000Z");
  // Offen, Kamera seit 11:40 still: Das Ereignis lief nachweislich bis dahin.
  assert.equal(activityAt(open, new Date("2026-11-24T11:40:00Z"), now).toISOString(), "2026-11-24T11:40:00.000Z");
  // Letzte Meldung der Kamera vor dem Beginn (Zeile nachgetragen): nie vor dem Beginn.
  assert.equal(activityAt(open, new Date("2026-11-24T07:00:00Z"), now).toISOString(), "2026-11-24T08:03:00.000Z");
});

test("Ende fuer die Anzeige: ohne Ende laeuft ein Ereignis nur, solange der Hub die Kamera meldet", () => {
  const open = { startedAt: new Date("2026-11-24T09:00:00Z"), endedAt: null };
  // Kamera frisch gemeldet: laeuft, also kein Ende.
  assert.equal(shownEndedAt(open, new Date("2026-11-24T11:59:10Z"), now), null);
  // Kamera seit 11:52 still: Das Ereignis endet fuer die Anzeige mit ihrer letzten Meldung.
  assert.equal(
    shownEndedAt(open, new Date("2026-11-24T11:52:00Z"), now)?.toISOString(),
    "2026-11-24T11:52:00.000Z",
  );
  // Kamera nie gemeldet: Es bleibt der Beginn.
  assert.equal(shownEndedAt(open, null, now)?.toISOString(), "2026-11-24T09:00:00.000Z");
  // Aelter als ein Tag: laeuft nicht mehr, auch bei frisch gemeldeter Kamera.
  assert.equal(
    shownEndedAt(
      { startedAt: new Date("2026-11-23T11:00:00Z"), endedAt: null },
      new Date("2026-11-24T11:59:10Z"),
      now,
    )?.toISOString(),
    "2026-11-24T11:59:10.000Z",
  );
  // Ein gemeldetes Ende bleibt, wie es ist.
  const ended = { ...open, endedAt: new Date("2026-11-24T09:30:00Z") };
  assert.equal(shownEndedAt(ended, new Date("2026-11-24T11:59:10Z"), now)?.toISOString(), "2026-11-24T09:30:00.000Z");
  assert.equal(shownEndedAt(ended, null, now)?.toISOString(), "2026-11-24T09:30:00.000Z");
});

test("Mehrere offene Ereignisse derselben Kamera und Art: nur das juengste kann noch laufen", () => {
  const open = [
    { id: 1, cameraId: 7, type: "MOTION", startedAt: new Date("2026-11-24T09:00:00Z") },
    { id: 2, cameraId: 7, type: "MOTION", startedAt: new Date("2026-11-24T11:00:00Z") },
    { id: 3, cameraId: 7, type: "PERSON", startedAt: new Date("2026-11-24T10:00:00Z") },
    { id: 4, cameraId: 8, type: "MOTION", startedAt: new Date("2026-11-24T08:00:00Z") },
    // Gleicher Beginn: die hoehere ID gilt als juenger.
    { id: 5, cameraId: 9, type: "MOTION", startedAt: new Date("2026-11-24T11:30:00Z") },
    { id: 6, cameraId: 9, type: "MOTION", startedAt: new Date("2026-11-24T11:30:00Z") },
  ];
  assert.deepEqual(staleOpen(open).map((e) => e.id), [1, 5]);
  assert.deepEqual(staleOpen([]), []);
  assert.deepEqual(staleOpen([open[2]]), []);
});

/** Ereignis einer Kamera im Raum; ohne Angabe hat der Hub die Kamera eben noch gemeldet. */
const ev = (
  roomId: number,
  cameraId: number,
  type: string,
  startedAt: string,
  endedAt: string | null,
  seen: Date | null = new Date("2026-11-24T11:59:30Z"),
) => ({
  roomId,
  cameraId,
  cameraName: `Kamera ${cameraId}`,
  type,
  startedAt: new Date(startedAt),
  endedAt: endedAt ? new Date(endedAt) : null,
  cameraLastSeenAt: seen,
});

test("Letztes Ereignis je Raum: laufende Bewegung geht vor einem juengeren, beendeten Ereignis", () => {
  const byRoom = latestActivityByRoom(
    [
      // Raum 1: Kamera 1 meldet seit 09:00 Bewegung, Kamera 2 hatte um 11:30 kurz eine Person.
      ev(1, 2, "PERSON", "2026-11-24T11:30:00Z", "2026-11-24T11:30:20Z"),
      ev(1, 1, "MOTION", "2026-11-24T09:00:00Z", null),
      ev(1, 1, "MOTION", "2026-11-24T09:00:00Z", null), // doppelt (aus beiden Abfragen)
      // Raum 2: langes Ereignis endete um 11:10, ein kuerzeres davor begann spaeter.
      ev(2, 3, "MOTION", "2026-11-24T08:03:00Z", "2026-11-24T11:10:00Z"),
      ev(2, 4, "PERSON", "2026-11-24T10:00:00Z", "2026-11-24T10:00:30Z"),
      // Raum 3: offen, aber die Kamera meldet sich seit 07:05 nicht mehr: zaehlt bis dahin.
      ev(3, 5, "MOTION", "2026-11-24T07:00:00Z", null, new Date("2026-11-24T07:05:00Z")),
      // Raum 4: zwei laufende, das zuletzt begonnene steht vorn.
      ev(4, 6, "MOTION", "2026-11-24T09:00:00Z", null),
      ev(4, 7, "PERSON", "2026-11-24T11:58:00Z", null),
    ],
    now,
  );
  assert.deepEqual(
    [...byRoom].map(([room, e]) => [room, e.cameraId, e.type, e.running, e.at]),
    [
      [1, 1, "MOTION", true, now.toISOString()],
      [2, 3, "MOTION", false, "2026-11-24T11:10:00.000Z"],
      [3, 5, "MOTION", false, "2026-11-24T07:05:00.000Z"],
      [4, 7, "PERSON", true, now.toISOString()],
    ],
  );
});

test("Letztes Ereignis je Raum: unter mehreren Ereignissen derselben Kamera zaehlt die juengste Aktivitaet", () => {
  const events = [
    // Raum 1, eine Kamera: Die Bewegung lief von 08:03 bis 11:10. Die Person
    // begann spaeter (10:00) und war nach 30 s vorbei.
    ev(1, 1, "PERSON", "2026-11-24T10:00:00Z", "2026-11-24T10:00:30Z"),
    ev(1, 1, "MOTION", "2026-11-24T08:03:00Z", "2026-11-24T11:10:00Z"),
    // Raum 2, eine Kamera, seit 11:50 nicht mehr gemeldet: Die offene Bewegung
    // lief nachweislich bis dahin, die Person war schon um 11:41 vorbei.
    ev(2, 2, "PERSON", "2026-11-24T11:40:00Z", "2026-11-24T11:41:00Z", new Date("2026-11-24T11:50:00Z")),
    ev(2, 2, "MOTION", "2026-11-24T09:00:00Z", null, new Date("2026-11-24T11:50:00Z")),
    // Raum 3, eine Kamera, letzte Meldung 11:40:30: Die Person endete danach
    // (11:41:10) und ist damit die juengste gesicherte Aktivitaet.
    ev(3, 3, "MOTION", "2026-11-24T09:00:00Z", null, new Date("2026-11-24T11:40:30Z")),
    ev(3, 3, "PERSON", "2026-11-24T11:40:00Z", "2026-11-24T11:41:10Z", new Date("2026-11-24T11:40:30Z")),
  ];
  const expected = [
    [1, 1, "MOTION", false, "2026-11-24T11:10:00.000Z"],
    [2, 2, "MOTION", false, "2026-11-24T11:50:00.000Z"],
    [3, 3, "PERSON", false, "2026-11-24T11:41:10.000Z"],
  ];
  const picked = (list: typeof events) =>
    [...latestActivityByRoom(list, now)]
      .sort(([a], [b]) => a - b)
      .map(([room, e]) => [room, e.cameraId, e.type, e.running, e.at]);
  assert.deepEqual(picked(events), expected);
  // In welcher Reihenfolge die Ereignisse ankommen, aendert die Auswahl nicht.
  assert.deepEqual(picked([...events].reverse()), expected);
});

test("Geoeffnete Seite: ein laufendes Ereignis gilt nur kurz nach dem Abruf noch als laufend", () => {
  const at = "2026-11-24T12:00:00.000Z"; // Abruf; so steht es bei einem laufenden Ereignis
  const fetched = Date.parse(at);
  const running = { at, running: true };
  assert.equal(shownAsRunning(running, fetched), true);
  assert.equal(shownAsRunning(running, fetched + 119_000), true);
  // Zwei Minuten nach dem Abruf und spaeter: Die Seite nennt das Alter der Angabe.
  assert.equal(shownAsRunning(running, fetched + 120_000), false);
  assert.equal(shownAsRunning(running, fetched + 3 * 3_600_000), false);
  // Die Uhr des Browsers geht nach: wie eben abgerufen.
  assert.equal(shownAsRunning(running, fetched - 30_000), true);
  // Ein beendetes Ereignis laeuft auch frisch abgerufen nicht.
  assert.equal(shownAsRunning({ at: "2026-11-24T11:59:00.000Z", running: false }, fetched), false);
});
