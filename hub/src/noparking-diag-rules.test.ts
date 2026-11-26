import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOST_MEMORY_MS,
  MAX_MISSES,
  SAME_VEHICLE_GAP_MS,
  emptyTrackState,
  track,
  type NoParkBox,
  type TrackState,
} from "./noparking-rules.js";
import { boxInfo, snapshotTrack, trackEvents, type TrackEvent } from "./noparking-diag-rules.js";

const car = (dx = 0): NoParkBox => ({ cls: 2, conf: 0.62, x: 0.7 + dx, y: 0.35, w: 0.12, h: 0.06 });
const STEP = 20_000;

/** Ein Durchlauf: track wie in noparking.ts, dazu die Ereignisse. */
function run(state: TrackState, boxes: NoParkBox[], now: number): TrackEvent[] {
  const before = snapshotTrack(state);
  const result = track(state, boxes, now);
  return trackEvents(before, state, now, result);
}
const names = (events: TrackEvent[]) => events.map((e) => e.event);

test("Ein Durchlauf ohne Wechsel ergibt kein Ereignis", () => {
  const s = emptyTrackState();
  let t = 0;
  assert.deepEqual(names(run(s, [car()], t)), ["first_seen"]);
  for (let i = 0; i < 5; i++) assert.deepEqual(run(s, [car()], (t += STEP)), []);
  assert.deepEqual(run(emptyTrackState(), [], 0), []);
});

test("zuerst gesehen: mit Größe, Sicherheit und Fußpunkt", () => {
  const [e] = run(emptyTrackState(), [car()], 0);
  assert.equal(e.event, "first_seen");
  assert.equal(e.candidate, true);
  assert.deepEqual(e.box, { areaPct: 0.72, conf: 0.62, footX: 0.76, footY: 0.41 });
  assert.deepEqual(boxInfo(car()), e.box);
});

test("Aussetzer: miss und found mit der Zahl der fehlenden Bilder", () => {
  const s = emptyTrackState();
  run(s, [car()], 0);
  run(s, [car()], STEP);
  const miss = run(s, [], 2 * STEP);
  assert.deepEqual(names(miss), ["miss"]);
  assert.equal(miss[0].seconds, 20);
  assert.deepEqual(run(s, [], 3 * STEP), []);
  const found = run(s, [car()], 4 * STEP);
  assert.deepEqual(names(found), ["found"]);
  assert.equal(found[0].missed, 2);
  assert.equal(found[0].seconds, 80);
  assert.equal(found[0].candidate, true);
  // Nach der Meldung bleibt der Aussetzer ein Ereignis, aber kein Kandidat mehr.
  s.standing[0].reportedAt = 4 * STEP;
  const later = run(s, [], 5 * STEP);
  assert.deepEqual(names(later), ["miss"]);
  assert.equal(later[0].candidate, false);
});

test("verloren, wiedergefunden, weggefahren: mit Standzeit und Lücke", () => {
  const s = emptyTrackState();
  let t = 0;
  run(s, [car()], t);
  for (let i = 0; i < 6; i++) run(s, [car()], (t += STEP));
  // Standzeit 120 s; dann fehlt das Fahrzeug MAX_MISSES + 1 Durchläufe.
  const missed: TrackEvent[] = [];
  for (let i = 0; i <= MAX_MISSES; i++) missed.push(...run(s, [], (t += STEP)));
  assert.deepEqual(names(missed), ["miss", "lost"]);
  assert.equal(missed[1].seconds, 120);

  // Nach 2 min wieder da: dasselbe Fahrzeug.
  const back = run(s, [car(0.01)], (t += STEP));
  assert.deepEqual(names(back), ["reacquired"]);
  assert.equal(back[0].gapSec, 100);
  assert.equal(back[0].seconds, 220);

  // Wieder weg, diesmal für immer: abgerissen, nach mehr als 3 Minuten beobachtet leer weggefahren.
  const seenAt = t;
  const gone: TrackEvent[] = [];
  while (t < seenAt + SAME_VEHICLE_GAP_MS + STEP) gone.push(...run(s, [], (t += STEP)));
  assert.deepEqual(names(gone), ["miss", "lost", "left"]);
  const left = gone[2];
  assert.deepEqual([left.seconds, left.gapSec, left.missed], [220, 200, 10]);
  // Gemerkt bleibt die Stelle bis LOST_MEMORY_MS nach der letzten Sichtung, ohne weiteres Ereignis.
  assert.equal(s.lost.length, 1);
  assert.deepEqual(run(s, [], seenAt + LOST_MEMORY_MS), []);
  assert.deepEqual(run(s, [], seenAt + LOST_MEMORY_MS + STEP), []);
  assert.equal(s.lost.length, 0);
});

/** Gemeldetes Fahrzeug (mit seiner Episode) ab t, danach 10 Minuten beobachtet leer. */
function reportedThenEmpty(): { s: TrackState; t: number; events: TrackEvent[] } {
  const s = emptyTrackState();
  let t = 1_000;
  run(s, [car()], t);
  s.standing[0].reportedAt = t;
  s.episode = { startedAt: t, firstAt: t, reminders: 0, tries: 0 };
  const events: TrackEvent[] = [];
  for (let i = 0; i < 30; i++) events.push(...run(s, [], (t += STEP)));
  return { s, t, events };
}

test("halb an derselben Stelle nach 10 Minuten beobachtet leer: neues Fahrzeug (reacquired_new) mit Lücke, nichts übernommen", () => {
  const { s, t, events } = reportedThenEmpty();
  assert.deepEqual(names(events), ["miss", "lost", "left"]);
  const e = run(s, [car(0.04)], t + STEP);
  assert.deepEqual(names(e), ["reacquired_new"]);
  assert.deepEqual([e[0].gapSec, e[0].missed, e[0].replacedReported, e[0].seconds, e[0].candidate], [620, 30, true, 0, true]);
  assert.deepEqual(e[0].box, boxInfo(car(0.04)));
  assert.equal(s.standing[0].firstSeenAt, t + STEP);
});

test("gemeldetes Fahrzeug nach 10 Minuten beobachtet leer an seiner Stelle: reacquired mit tight, die Standzeit läuft weiter", () => {
  const { s, t } = reportedThenEmpty();
  const e = run(s, [car(0.01)], t + STEP);
  assert.deepEqual(names(e), ["reacquired"]);
  assert.deepEqual([e[0].tight, e[0].gapSec, e[0].seconds, e[0].candidate], [true, 620, 620, false]);
  assert.equal(s.standing[0].firstSeenAt, 1_000);
  // Nach kurzer Lücke wiedergefunden: ohne tight.
  const short = emptyTrackState();
  run(short, [car()], 0);
  for (let i = 1; i <= MAX_MISSES + 1; i++) run(short, [], i * STEP);
  const back = run(short, [car()], (MAX_MISSES + 2) * STEP);
  assert.deepEqual([names(back), back[0].tight], [["reacquired"], undefined]);
});

test("nach langer Lücke ohne Beobachtung (Hub aus) an derselben Stelle: wiedergefunden, die Standzeit läuft weiter", () => {
  const s = emptyTrackState();
  let t = 0;
  run(s, [car()], t);
  for (let i = 0; i <= MAX_MISSES; i++) run(s, [], (t += STEP));
  assert.equal(s.lost.length, 1);
  const e = run(s, [car()], (t += 10 * 60_000));
  assert.deepEqual(names(e), ["reacquired"]);
  assert.equal(e[0].gapSec, 680);
  assert.equal(e[0].seconds, 680);
});

test("zwei Fahrzeuge: je eines ihrer Ereignisse", () => {
  const s = emptyTrackState();
  assert.deepEqual(names(run(s, [car(), car(-0.14)], 0)), ["first_seen", "first_seen"]);
  assert.deepEqual(names(run(s, [car()], STEP)), ["miss"]);
});
