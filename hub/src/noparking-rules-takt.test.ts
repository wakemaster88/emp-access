import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDLE_CHECK_MS,
  LOST_MEMORY_MS,
  MAX_REPORT_TRIES,
  NIGHT_CHECK_MS,
  SAME_VEHICLE_GAP_MS,
  VEHICLE_EVENT_WINDOW_MS,
  applyDelivery,
  applyPlan,
  checkDelay,
  emptyTrackState,
  nextCheckDelayMs,
  noteBlind,
  observedGapLimitMs,
  planReport,
  soonestCheck,
  track,
  type CheckDelayConfig,
  type CheckSignals,
  type NoParkBox,
  type TrackState,
} from "./noparking-rules.js";

/*
 * Zusage an den Betreiber: bei leerer Fläche alle 60 Sekunden (nachts 120),
 * sobald ein Fahrzeug da ist, wieder alle 20.
 */

const SEC = 1_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 6, 11, 0, 0);
const car: NoParkBox = { cls: 2, conf: 0.5, x: 0.54, y: 0.24, w: 0.12, h: 0.06 };

const cfg = (o: Partial<CheckDelayConfig> = {}): CheckDelayConfig => ({
  activeMs: 20 * SEC,
  idleMs: IDLE_CHECK_MS,
  nightMs: NIGHT_CHECK_MS,
  hour: 12,
  fixed: false,
  ...o,
});
const signals = (s: TrackState, o: Partial<CheckSignals> = {}) => Object.assign(s, { lastRunFailed: false, vehicleEventAt: 0, ...o });

test("Leere Fläche: 60 s, zwischen 22 und 6 Uhr 120 s", () => {
  assert.equal(IDLE_CHECK_MS, 60 * SEC);
  assert.equal(NIGHT_CHECK_MS, 120 * SEC);
  const s = signals(emptyTrackState());
  assert.equal(nextCheckDelayMs(s, T0, cfg({ hour: 12 })), 60 * SEC);
  assert.equal(nextCheckDelayMs(s, T0, cfg({ hour: 21.99 })), 60 * SEC);
  assert.equal(nextCheckDelayMs(s, T0, cfg({ hour: 22 })), 120 * SEC);
  assert.equal(nextCheckDelayMs(s, T0, cfg({ hour: 3 })), 120 * SEC);
  assert.equal(nextCheckDelayMs(s, T0, cfg({ hour: 5.99 })), 120 * SEC);
  assert.equal(nextCheckDelayMs(s, T0, cfg({ hour: 6 })), 60 * SEC);
  assert.equal(checkDelay(s, T0, cfg({ hour: 23 })).reason, "nacht");
});

test("Fahrzeug in der Fläche, auch schon gemeldet: 20 s, tags wie nachts", () => {
  const s = signals(emptyTrackState());
  track(s, [car], T0);
  assert.deepEqual(checkDelay(s, T0, cfg()), { ms: 20 * SEC, reason: "fahrzeug" });
  assert.equal(nextCheckDelayMs(s, T0, cfg({ hour: 2 })), 20 * SEC);
  s.standing[0].reportedAt = T0;
  s.standing[0].stored = true;
  assert.equal(nextCheckDelayMs(s, T0 + 30 * MIN, cfg()), 20 * SEC);
});

test("Spur mit Aussetzer und gerade abgerissene Spur: 20 s, nach 3 min leer wieder 60 s", () => {
  const s = signals(emptyTrackState());
  track(s, [car], T0);
  track(s, [], T0 + 20 * SEC);
  assert.equal(checkDelay(s, T0 + 20 * SEC, cfg()).reason, "aussetzer");
  for (let i = 2; i <= 5; i++) track(s, [], T0 + i * 20 * SEC);
  assert.equal(s.standing.length, 0);
  assert.equal(s.lost.length, 1);
  assert.equal(checkDelay(s, T0 + 100 * SEC, cfg()).reason, "abgerissen");
  // Zuletzt gesehen bei T0: nach mehr als 3 min beobachtet leer ist das Fahrzeug weggefahren.
  assert.equal(nextCheckDelayMs(s, T0 + SAME_VEHICLE_GAP_MS, cfg()), 20 * SEC);
  assert.equal(nextCheckDelayMs(s, T0 + SAME_VEHICLE_GAP_MS + 1, cfg()), 60 * SEC);
  // Eine Prüfung ohne Ergebnis (Tracker weg) zählt nicht als leer: weiter der kurze Takt.
  noteBlind(s);
  assert.deepEqual(checkDelay(s, T0 + 10 * MIN, cfg()), { ms: 20 * SEC, reason: "abgerissen" });
  // Im kurzen Takt weiter leer: weggefahren, wieder 60 s.
  for (let t = T0 + 10 * MIN; t <= T0 + 10 * MIN + 80 * SEC; t += 20 * SEC) track(s, [], t);
  assert.deepEqual([s.lost[0].missedMs, s.lost[0].gone], [SAME_VEHICLE_GAP_MS, false]);
  track(s, [], T0 + 10 * MIN + 100 * SEC);
  assert.equal(s.lost[0].gone, true);
  assert.deepEqual(checkDelay(s, T0 + 10 * MIN + 120 * SEC, cfg()), { ms: 60 * SEC, reason: "leer" });
});

test("Offene Meldung an die Cloud: 20 s, damit der nächste Versuch nicht wartet", () => {
  const s = signals(emptyTrackState());
  const c = { minutes: 2, speak: false, speakHour: 12, speakFrom: 8, speakTo: 22, notifyHour: 12, notifyFrom: 7, notifyTo: 22 };
  track(s, [car], T0);
  track(s, [car], T0 + 2 * MIN);
  const plan = planReport(s, T0 + 2 * MIN, c);
  applyPlan(s, plan, T0 + 2 * MIN);
  applyDelivery(s, plan, false, T0 + 2 * MIN);
  // Fahrzeug fährt weg, die Fläche ist seit über 3 min leer (im kurzen Takt geprüft) – die Meldung steht noch aus.
  const later = T0 + 10 * MIN;
  for (let t = T0 + 2 * MIN + 20 * SEC; t <= later; t += 20 * SEC) track(s, [], t);
  assert.equal(s.standing.length, 0);
  assert.equal(s.lost[0].gone, true);
  assert.deepEqual(checkDelay(s, later, cfg()), { ms: 20 * SEC, reason: "meldung" });
  // Die Episode wartet bis 15 Minuten nach der letzten Sichtung auf das Fahrzeug, mit offener erster Nachricht.
  assert.deepEqual([s.episode?.vacated, s.episode?.tries], [true, 1]);
  const end = T0 + 2 * MIN + LOST_MEMORY_MS + 20 * SEC;
  for (let t = later + 20 * SEC; t <= end; t += 20 * SEC) track(s, [], t);
  assert.equal(s.episode, null);
  // Offen ist nur noch der Eintrag in der Historie; nach MAX_REPORT_TRIES aufgegeben: wieder 60 s.
  assert.deepEqual(checkDelay(s, end, cfg()), { ms: 20 * SEC, reason: "meldung" });
  for (const l of s.lost) l.storeTries = MAX_REPORT_TRIES;
  assert.equal(nextCheckDelayMs(s, end, cfg()), 60 * SEC);
});

test("Langer Takt (HUB_NOPARK_INTERVAL=330): die abgerissene Spur zählt als beobachtet leer und ist nach 3 leeren Prüfungen weggefahren", () => {
  const long = cfg({ activeMs: 330 * SEC });
  const reported = () => {
    const s = signals(emptyTrackState());
    track(s, [car], T0);
    Object.assign(s.standing[0], { reportedAt: T0, stored: true });
    return s;
  };
  const s = reported();
  for (let i = 1; i <= 3; i++) track(s, [], T0 + i * 330 * SEC, { gapLimitMs: observedGapLimitMs(330 * SEC) });
  assert.deepEqual([s.lost.length, s.lost[0].missedMs, s.lost[0].emptyChecks, s.lost[0].gone], [1, 990 * SEC, 3, true]);
  assert.deepEqual(checkDelay(s, T0 + 3 * 330 * SEC, long), { ms: 330 * SEC, reason: "leer" });
  // Ohne Grenze aus dem Takt zählte keine Zeit als leer: Die Spur bliebe „gerade weg“.
  const blind = reported();
  for (let i = 1; i <= 4; i++) track(blind, [], T0 + i * 330 * SEC);
  assert.deepEqual([blind.lost[0].missedMs, blind.lost[0].gone], [0, false]);
  // checkDelay leitet die Grenze selbst aus dem längsten Takt ab.
  assert.equal(checkDelay(blind, T0 + 5 * 330 * SEC, long).reason, "leer");
  assert.equal(checkDelay(blind, T0 + 5 * 330 * SEC, cfg()).reason, "abgerissen", "bei 20 s Takt höchstens 5 min");
});

test("Letzter Durchlauf ohne Ergebnis: 20 s", () => {
  const s = signals(emptyTrackState(), { lastRunFailed: true });
  assert.deepEqual(checkDelay(s, T0, cfg({ hour: 3 })), { ms: 20 * SEC, reason: "fehler" });
});

test("Kamera meldet selbst ein Fahrzeug: 3 Minuten lang 20 s", () => {
  const s = signals(emptyTrackState(), { vehicleEventAt: T0 });
  assert.deepEqual(checkDelay(s, T0 + 10 * SEC, cfg()), { ms: 20 * SEC, reason: "kamera" });
  assert.equal(nextCheckDelayMs(s, T0 + VEHICLE_EVENT_WINDOW_MS - 1, cfg()), 20 * SEC);
  assert.equal(nextCheckDelayMs(s, T0 + VEHICLE_EVENT_WINDOW_MS, cfg()), 60 * SEC);
});

test("HUB_NOPARK_FIXED_INTERVAL=1: immer der kurze Takt wie bisher", () => {
  const s = signals(emptyTrackState());
  assert.deepEqual(checkDelay(s, T0, cfg({ fixed: true, hour: 3 })), { ms: 20 * SEC, reason: "fest" });
  // HUB_NOPARK_INTERVAL länger als der Ruhetakt: nie kürzer als der kurze Takt.
  assert.equal(nextCheckDelayMs(s, T0, cfg({ activeMs: 90 * SEC })), 90 * SEC);
});

test("Mehrere Kameras: die kürzeste Wartezeit zählt; ohne Kamera die der leeren Fläche", () => {
  const empty = signals(emptyTrackState());
  const busy = signals(emptyTrackState());
  track(busy, [car], T0);
  assert.deepEqual(soonestCheck([empty, busy], T0, cfg()), { ms: 20 * SEC, reason: "fahrzeug" });
  assert.deepEqual(soonestCheck([empty], T0, cfg()), { ms: 60 * SEC, reason: "leer" });
  assert.deepEqual(soonestCheck([], T0, cfg({ hour: 23 })), { ms: 120 * SEC, reason: "nacht" });
});

test("Ablauf: Fahrzeug parkt in der leeren Fläche ein – erste Sichtung spätestens nach dem Ruhetakt, Standzeit ab dort", () => {
  // Durchläufe nach dem Takt; das Fahrzeug steht ab 12:00:30 (Box sichtbar).
  const s = signals(emptyTrackState());
  const arrive = T0 + 30 * SEC;
  const c = { minutes: 2, speak: false, speakHour: 12, speakFrom: 8, speakTo: 22, notifyHour: 12, notifyFrom: 7, notifyTo: 22 };
  const runs: number[] = [];
  let due = 0;
  for (let t = T0; t < T0 + 10 * MIN; t += nextCheckDelayMs(s, t, cfg())) {
    runs.push(t);
    track(s, t >= arrive ? [car] : [], t);
    const plan = planReport(s, t, c);
    applyPlan(s, plan, t);
    if (plan.due.length > 0) due = t;
  }
  // 12:00:00 leer, 12:01:00 gesehen, danach alle 20 s; gemeldet 2 min nach der ersten Sichtung.
  assert.equal(runs[1] - runs[0], 60 * SEC);
  assert.equal(s.standing[0].firstSeenAt, T0 + 60 * SEC);
  assert.equal(due, T0 + 3 * MIN);
  assert.ok(runs.slice(1).every((t, i) => i === 0 || t - runs[i] === 20 * SEC));
});
