import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MIN_AREA,
  DEFAULT_MIN_CONF,
  DUPLICATE_IOU,
  LOST_MEMORY_MS,
  MAX_MISSES,
  OBSERVED_GAP_FACTOR,
  OBSERVED_GAP_MAX_MS,
  REPORTED_MEMORY_MS,
  SAME_SPOT_IOU,
  SAME_VEHICLE_GAP_MS,
  SAME_VEHICLE_IOU,
  SAME_VEHICLE_MAX_EMPTY_CHECKS,
  SPEAK_WAIT_MS,
  STUCK_RUN_MS,
  coverBoxes,
  emptyTrackState,
  finishThenSave,
  footPoint,
  intersects,
  lostMayReturn,
  noteBlind,
  observedGapLimitMs,
  observedGapMs,
  overlap,
  parseTrackStates,
  relevantBoxes,
  runExclusive,
  sameVehicle,
  sameVehicleGap,
  serialQueue,
  serializeTrackStates,
  track,
  waitAtMost,
  withinSpeakWindow,
  type Episode,
  type NoParkBox,
  type RunSlot,
  type TrackState,
} from "./noparking-rules.js";
import { parseZone } from "./zone-rules.js";

/*
 * Messwerte aus dem Aufbau am Eingang (hub/IMPROVE.md, 13.09.): Die Fläche
 * liegt rechts neben der Straße, die Radaufstandspunkte geparkter Autos bei
 * x 0,546–0,797 und y 0,178–0,319; ein Pkw auf dem Schotter belegt 0,7–1,8 %
 * der Bildfläche, die Autos auf dem Parkplatz dahinter 0,1–0,3 %.
 */
const ZONE = parseZone("0.53,0.14;0.94,0.14;0.94,0.63;0.53,0.63")!;
const FILTER = { minConf: DEFAULT_MIN_CONF, minArea: DEFAULT_MIN_AREA };
const SEC = 1_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 6, 17, 0, 0);

/** Box mit dem Radaufstandspunkt (fx, fy), Breite w und Höhe h. */
const atFoot = (fx: number, fy: number, w: number, h: number, o: Partial<NoParkBox> = {}): NoParkBox => ({
  cls: 2,
  conf: 0.6,
  x: fx - w / 2,
  y: fy - h,
  w,
  h,
  ...o,
});
/** Pkw auf dem Schotter: 0,71 % der Bildfläche, Fuß bei (0,7; 0,3). */
const CAR = atFoot(0.7, 0.3, 0.12, 0.0592, { conf: 0.45 });
/** Fast dieselbe Stelle wie CAR: Überdeckung 0,85 (ab SAME_SPOT_IOU). */
const NEAR = { ...CAR, x: CAR.x + 0.01 };
/** Halb versetzt: Überdeckung 0,5 (ab SAME_VEHICLE_IOU, unter SAME_SPOT_IOU). */
const HALF = { ...CAR, x: CAR.x + CAR.w / 3 };

test("overlap: gleiche Box 1, getrennte 0, halbe Verschiebung ein Drittel", () => {
  assert.equal(overlap(CAR, CAR), 1);
  assert.equal(overlap(CAR, { ...CAR, x: CAR.x + 0.5 }), 0);
  const half = { ...CAR, x: CAR.x + CAR.w / 2 };
  assert.ok(Math.abs(overlap(CAR, half) - 1 / 3) < 1e-9);
  // Eine Box ohne Fläche zählt nicht.
  assert.equal(overlap({ ...CAR, w: 0, h: 0 }, { ...CAR, w: 0, h: 0 }), 0);
});

test("Überdeckungen der Testboxen und intersects: jede Schnittfläche größer als 0 zählt", () => {
  assert.equal(SAME_SPOT_IOU, 0.75);
  assert.ok(overlap(CAR, NEAR) >= SAME_SPOT_IOU);
  assert.ok(Math.abs(overlap(CAR, HALF) - 0.5) < 1e-9);
  assert.ok(overlap(CAR, HALF) >= SAME_VEHICLE_IOU && overlap(CAR, HALF) < SAME_SPOT_IOU);
  assert.equal(intersects(CAR, { ...CAR, x: CAR.x + CAR.w - 0.001 }), true);
  assert.equal(intersects(CAR, { ...CAR, x: CAR.x + CAR.w }), false, "nur berührt");
  assert.equal(intersects(CAR, { ...CAR, y: CAR.y + CAR.h + 0.01 }), false);
});

test("footPoint: Mitte der Unterkante", () => {
  const p = footPoint({ cls: 2, conf: 1, x: 0.2, y: 0.1, w: 0.2, h: 0.3 });
  assert.ok(Math.abs(p.x - 0.3) < 1e-12 && Math.abs(p.y - 0.4) < 1e-12);
});

test("relevantBoxes: Pkw auf dem Schotter zählt, Autos auf dem Parkplatz dahinter nicht", () => {
  const far = atFoot(0.8, 0.25, 0.05, 0.04); // 0,2 % der Bildfläche
  assert.deepEqual(relevantBoxes([CAR, far], ZONE, FILTER), [CAR]);
});

test("relevantBoxes: Doppelerkennung als Auto und Lastwagen zählt einmal, die sicherere bleibt", () => {
  const asCar = atFoot(0.7, 0.3, 0.14, 0.08, { cls: 2, conf: 0.49 });
  const asTruck = { ...asCar, cls: 7, conf: 0.58, w: asCar.w * 0.98 };
  assert.ok(overlap(asCar, asTruck) >= 0.6);
  assert.deepEqual(relevantBoxes([asCar, asTruck], ZONE, FILTER), [asTruck]);
  // Zwei Autos nebeneinander bleiben zwei.
  const neighbour = atFoot(0.85, 0.3, 0.12, 0.0592, { conf: 0.5 });
  assert.equal(relevantBoxes([CAR, neighbour], ZONE, FILTER).length, 2);
});

test("relevantBoxes: Transporter mit Fußpunkt neben der Fläche bleibt außen, obwohl er hineinragt", () => {
  // Lieferwagen im Vordergrund: Fuß bei (0,668; 0,920), 35,7 % Bildfläche.
  const van = atFoot(0.668, 0.92, 0.6, 0.595, { cls: 2, conf: 0.8 });
  const center = { x: van.x + van.w / 2, y: van.y + van.h / 2 };
  assert.ok(center.y < 0.63, "Mittelpunkt liegt in der Fläche");
  assert.deepEqual(relevantBoxes([van], ZONE, FILTER), []);
});

test("relevantBoxes: Klasse, Vertrauen und Mindestgröße aus den Einstellungen", () => {
  assert.deepEqual(relevantBoxes([{ ...CAR, cls: 0 }], ZONE, FILTER), [], "Person");
  assert.deepEqual(relevantBoxes([{ ...CAR, cls: 3 }], ZONE, FILTER).length, 1, "Motorrad");
  assert.deepEqual(relevantBoxes([{ ...CAR, conf: 0.34 }], ZONE, FILTER), []);
  assert.equal(relevantBoxes([{ ...CAR, conf: 0.34 }], ZONE, { ...FILTER, minConf: 0.3 }).length, 1);
  assert.equal(relevantBoxes([CAR], ZONE, { ...FILTER, minArea: 0.01 }).length, 0);
});

test("track: neue Box wird ein Fahrzeug mit Standzeit ab der ersten Sichtung, die Box wird nachgezogen", () => {
  const state = emptyTrackState();
  assert.deepEqual(track(state, [CAR], T0), { added: 1, lost: 0, reacquired: 0, replaced: 0, left: 0, tight: [], episodeEnded: false });
  const moved = { ...CAR, x: CAR.x + 0.002 };
  assert.equal(track(state, [moved], T0 + 20 * SEC).added, 0);
  assert.equal(state.standing.length, 1);
  assert.equal(state.standing[0].firstSeenAt, T0);
  assert.equal(state.standing[0].lastSeenAt, T0 + 20 * SEC);
  assert.equal(state.standing[0].box, moved);
  assert.equal(state.standing[0].id, `${T0}-0`);
});

test("track: bis zu 3 Aussetzer überbrücken, beim 4. reißt die Spur ab und wird gemerkt", () => {
  const state = emptyTrackState();
  track(state, [CAR], T0);
  for (let miss = 1; miss <= MAX_MISSES; miss++) {
    assert.equal(track(state, [], T0 + miss * 20 * SEC).lost, 0);
    assert.equal(state.standing.length, 1, `nach ${miss} Aussetzern noch da`);
    assert.equal(state.standing[0].misses, miss);
    assert.equal(state.standing[0].missedMs, miss * 20 * SEC);
    assert.equal(state.standing[0].emptyChecks, miss);
  }
  // Zurück nach 3 Aussetzern: Standzeit läuft weiter.
  track(state, [CAR], T0 + 80 * SEC);
  assert.equal(state.standing[0].firstSeenAt, T0);
  assert.deepEqual([state.standing[0].misses, state.standing[0].missedMs, state.standing[0].emptyChecks], [0, 0, 0]);
  // Vier Aussetzer am Stück: abgerissen, aber gemerkt.
  let lost = 0;
  for (let miss = 1; miss <= MAX_MISSES + 1; miss++) lost += track(state, [], T0 + 80 * SEC + miss * 20 * SEC).lost;
  assert.equal(lost, 1);
  assert.equal(state.standing.length, 0);
  assert.equal(state.lost.length, 1);
  assert.equal(state.lost[0].lostAt, T0 + 160 * SEC);
  assert.equal(state.lost[0].gone, false);
});

test("sameVehicleGap: höchstens 3 Minuten beobachtet leer oder höchstens 2 leere Prüfungen", () => {
  assert.equal(SAME_VEHICLE_GAP_MS, 3 * MIN);
  assert.equal(SAME_VEHICLE_MAX_EMPTY_CHECKS, 2);
  assert.equal(sameVehicleGap(3 * MIN, 9), true);
  assert.equal(sameVehicleGap(3 * MIN + 1, 9), false);
  // Langer Takt (nachts 120 s): zwei leere Prüfungen sind 4 Minuten, noch dasselbe Fahrzeug.
  assert.equal(sameVehicleGap(4 * MIN, 2), true);
  assert.equal(sameVehicleGap(6 * MIN, 3), false);
});

test("observedGapLimitMs: mindestens 5 Minuten, bei langem Takt 2,5-mal der längste", () => {
  assert.equal(OBSERVED_GAP_FACTOR, 2.5);
  assert.equal(observedGapLimitMs(120 * SEC), OBSERVED_GAP_MAX_MS, "Standard: nachts 120 s");
  assert.equal(observedGapLimitMs(330 * SEC), 825 * SEC, "HUB_NOPARK_INTERVAL=330");
  assert.equal(observedGapLimitMs(Number.NaN), OBSERVED_GAP_MAX_MS);
  // Mit der Grenze des Takts zählt der Abstand als beobachtet.
  const s = emptyTrackState();
  track(s, [], T0);
  assert.equal(observedGapMs(s, T0 + 330 * SEC), 0);
  assert.equal(observedGapMs(s, T0 + 330 * SEC, observedGapLimitMs(330 * SEC)), 330 * SEC);
});

test("observedGapMs: nur der Abstand zur letzten Prüfung mit Ergebnis, ohne Ausfall, Neustart oder Uhrsprung", () => {
  const s = emptyTrackState();
  assert.equal(observedGapMs(s, T0), 0, "erste Prüfung");
  track(s, [], T0);
  assert.equal(observedGapMs(s, T0 + 20 * SEC), 20 * SEC);
  assert.equal(observedGapMs(s, T0 + OBSERVED_GAP_MAX_MS), OBSERVED_GAP_MAX_MS);
  assert.equal(observedGapMs(s, T0 + OBSERVED_GAP_MAX_MS + 1), 0, "Hub aus oder Mac im Ruhezustand");
  assert.equal(observedGapMs(s, T0 - SEC), 0, "Uhr zurückgesprungen");
  noteBlind(s);
  assert.equal(observedGapMs(s, T0 + 20 * SEC), 0, "Prüfung ohne Ergebnis dazwischen");
  track(s, [], T0 + 40 * SEC);
  assert.equal(observedGapMs(s, T0 + 60 * SEC), 20 * SEC);
});

test("track: eine abgerissene Spur kommt nach kurzer Lücke zurück – dasselbe Fahrzeug, alles bleibt", () => {
  const state = emptyTrackState();
  track(state, [CAR], T0);
  state.standing[0].reportedAt = T0 + 2 * MIN;
  state.standing[0].stored = true;
  state.standing[0].speaks = 1;
  state.standing[0].spokeAt = T0 + 2 * MIN;
  const lastSeen = T0 + 3 * MIN;
  track(state, [CAR], lastSeen);
  const vehicle = state.standing[0];
  for (let miss = 1; miss <= MAX_MISSES + 1; miss++) track(state, [], lastSeen + miss * 20 * SEC);
  assert.equal(state.lost.length, 1);
  // Genau 3 Minuten nach der letzten Sichtung: noch dasselbe.
  const res = track(state, [{ ...CAR, conf: 0.4 }], lastSeen + SAME_VEHICLE_GAP_MS);
  assert.equal(res.reacquired, 1);
  assert.equal(res.added, 0);
  assert.equal(state.lost.length, 0);
  const back = state.standing[0];
  assert.equal(back, vehicle, "dasselbe Objekt");
  assert.deepEqual(
    [back.id, back.firstSeenAt, back.reportedAt, back.stored, back.speaks, back.misses, back.missedMs],
    [`${T0}-0`, T0, T0 + 2 * MIN, true, 1, 0, 0],
  );
  assert.equal("lostAt" in back, false);
});

test("sameVehicle: die unverdeckte Leere begrenzt nur sameVehicleGap, die 15 Minuten nur die verdeckte Zeit", () => {
  // Langer Takt (330 s): zwei leere Prüfungen, mit der jetzigen 16,5 Minuten beobachtet leer – noch dasselbe.
  assert.equal(sameVehicle({ missedMs: 11 * MIN, emptyChecks: 2, unseenMs: 11 * MIN }, 5.5 * MIN), true);
  // Höchstens 15 Minuten verdeckt (unseenMs − missedMs) …
  assert.equal(sameVehicle({ missedMs: MIN, emptyChecks: 3, unseenMs: MIN + LOST_MEMORY_MS }, 20 * SEC), true);
  // … länger nicht, auch ohne Leere.
  assert.equal(sameVehicle({ missedMs: 0, emptyChecks: 0, unseenMs: LOST_MEMORY_MS + 1 }), false);
  // Die Leere wie sameVehicleGap: mehr als 3 Minuten und mehr als 2 Prüfungen – nicht mehr.
  assert.equal(sameVehicle({ missedMs: 3 * MIN, emptyChecks: 9, unseenMs: 3 * MIN }, 1), false);
});

/** Gemeldetes Fahrzeug A (Episode ab seiner Meldung), ab `from` fort; bis dahin alle 20 s gesehen. */
function reportedThenGone(from: number): TrackState {
  const state = emptyTrackState();
  track(state, [CAR], T0);
  Object.assign(state.standing[0], { reportedAt: T0 + 2 * MIN, stored: true, storeTries: 1, storeKey: `${T0}-0`, speaks: 2, spokeAt: T0 + 12 * MIN });
  state.episode = { startedAt: T0 + 2 * MIN, firstAt: T0 + 2 * MIN, reminders: 0, tries: 0 };
  for (let t = T0 + 20 * SEC; t < from; t += 20 * SEC) track(state, [CAR], t);
  return state;
}

test("track: Fläche 10 Minuten beobachtet leer, dann eine Box mit Überdeckung 0,5 – ein neues Fahrzeug, nichts geerbt", () => {
  const state = reportedThenGone(T0 + 20 * MIN);
  const a = state.standing[0];
  let left = 0;
  for (let t = T0 + 20 * MIN; t < T0 + 30 * MIN; t += 20 * SEC) left += track(state, [], t).left;
  assert.equal(left, 1, "nach mehr als 3 Minuten weggefahren");
  assert.equal(state.lost[0], a);
  assert.equal(state.lost[0].gone, true);
  assert.equal(state.episode?.vacated, true, "die Episode wartet nur noch auf A");
  const res = track(state, [{ ...HALF, conf: 0.5 }], T0 + 30 * MIN);
  assert.deepEqual([res.added, res.reacquired, res.replaced, res.tight], [1, 0, 1, []]);
  const b = state.standing[0];
  assert.notEqual(b, a);
  assert.deepEqual(
    [b.id, b.firstSeenAt, b.reportedAt, b.stored, b.storeTries, b.storeKey, b.speaks, b.spokeAt],
    [`${T0 + 30 * MIN}-0`, T0 + 30 * MIN, 0, false, 0, null, 0, 0],
  );
  // A ist ohne offenen Eintrag nicht mehr gemerkt, die Episode ist vorbei.
  assert.equal(state.lost.length, 0);
  assert.deepEqual([res.episodeEnded, state.episode], [true, null]);
});

test("track: gemeldetes Fahrzeug nach 10 Minuten beobachteter Leere an seiner Stelle (SAME_SPOT_IOU) – dasselbe, mit Episode", () => {
  const state = reportedThenGone(T0 + 20 * MIN);
  const a = state.standing[0];
  const episode = state.episode;
  for (let t = T0 + 20 * MIN; t < T0 + 30 * MIN; t += 20 * SEC) track(state, [], t);
  assert.deepEqual([state.lost[0], state.lost[0].gone], [a, true]);
  // 10 Minuten 20 s nach der letzten Sichtung (bis LOST_MEMORY_MS): dasselbe, auch nach langer Leere.
  const res = track(state, [NEAR], T0 + 30 * MIN);
  assert.deepEqual([res.added, res.reacquired, res.replaced, res.tight], [0, 1, 0, [`${T0}-0`]]);
  assert.equal(state.standing[0], a);
  assert.deepEqual([a.firstSeenAt, a.reportedAt, a.stored, a.speaks, "gone" in a], [T0, T0 + 2 * MIN, true, 2, false]);
  assert.equal(state.episode, episode);
  assert.equal(state.episode?.vacated, undefined, "die Episode läuft weiter");
});

test("track: engere Wiedererkennung nur bis 15 Minuten nach der letzten Sichtung und nur für gemeldete Fahrzeuge der Episode", () => {
  // Letzte Sichtung T0 + 19:40; 15 Minuten danach noch dasselbe, 20 s später nicht mehr.
  for (const [back, same] of [[T0 + 19 * MIN + 40 * SEC + LOST_MEMORY_MS, true], [T0 + 20 * MIN + LOST_MEMORY_MS, false]] as const) {
    const state = reportedThenGone(T0 + 20 * MIN);
    for (let t = T0 + 20 * MIN; t < back; t += 20 * SEC) track(state, [], t);
    const res = track(state, [CAR], back);
    assert.equal(res.reacquired, same ? 1 : 0, `zurück nach ${(back - T0) / SEC} s`);
    assert.equal(state.standing[0].firstSeenAt === T0, same);
  }
  // Noch nicht gemeldet: nur nach kurzer Lücke dasselbe.
  const unreported = emptyTrackState();
  unreported.episode = { startedAt: T0, firstAt: T0, reminders: 0, tries: 0 };
  track(unreported, [CAR], T0);
  for (let t = T0 + 20 * SEC; t <= T0 + 5 * MIN; t += 20 * SEC) track(unreported, [], t);
  assert.equal(track(unreported, [CAR], T0 + 5 * MIN + 20 * SEC).added, 1);
  // Gemeldet in einer früheren Episode: nicht dasselbe.
  const earlier = reportedThenGone(T0 + 20 * MIN);
  for (let t = T0 + 20 * MIN; t < T0 + 30 * MIN; t += 20 * SEC) track(earlier, [], t);
  earlier.episode = { startedAt: T0 + 29 * MIN, firstAt: T0 + 29 * MIN, reminders: 0, tries: 0 };
  assert.equal(track(earlier, [CAR], T0 + 30 * MIN).added, 1);
});

test("track: engere Wiedererkennung nach beobachteter Zeit – 20 Minuten ohne Beobachtung zählen nicht, auch über einen Neustart", () => {
  for (const restart of [false, true]) {
    let state = reportedThenGone(T0 + 20 * MIN);
    const a = state.standing[0];
    for (let t = T0 + 20 * MIN; t < T0 + 30 * MIN; t += 20 * SEC) track(state, [], t);
    assert.deepEqual([state.lost[0].gone, state.episode?.vacated], [true, true]);
    // 10 Minuten beobachtet leer, dann 20 Minuten ohne Ergebnis (Hub aus bzw. Kamera nicht in Grundstellung).
    if (restart) state = parseTrackStates(serializeTrackStates(new Map([[1, state]]), T0 + 30 * MIN), T0 + 50 * MIN).get(1)!;
    else noteBlind(state);
    const episode = state.episode;
    assert.equal(state.lost.length, 1, "A ist noch gemerkt");
    const res = track(state, [NEAR], T0 + 50 * MIN);
    assert.deepEqual([res.reacquired, res.added, res.tight, res.episodeEnded], [1, 0, [`${T0}-0`], false], `Neustart ${restart}`);
    assert.equal(state.standing[0].firstSeenAt, T0);
    if (!restart) assert.equal(state.standing[0], a);
    assert.deepEqual([state.episode, state.episode?.vacated], [episode, undefined]);
  }
});

test("track: die Episode endet nicht, solange ihr Fahrzeug locker noch dasselbe ist (13 Minuten verdeckt, dann kurz leer)", () => {
  const state = reportedThenGone(T0 + 20 * MIN);
  const episode = state.episode!;
  const van = atFoot(0.7, 0.7, 0.3, 0.45, { cls: 7, conf: 0.8 });
  let ended = false;
  let t = T0 + 20 * MIN;
  // Letzte Sichtung 19:40; verdeckt bis 32:40 (Fläche leer, die Episode wartet), dann 2:40 leer.
  for (; t < T0 + 33 * MIN; t += 20 * SEC) ended ||= track(state, [], t, { covers: [van] }).episodeEnded;
  for (; t < T0 + 35 * MIN + 40 * SEC; t += 20 * SEC) ended ||= track(state, [], t).episodeEnded;
  const a = state.lost[0];
  // Bis zur letzten Prüfung (35:20) 15:40 ohne Sichtung, davon 2:40 leer.
  assert.deepEqual([a.unseenMs, a.missedMs, a.gone], [15 * MIN + 40 * SEC, 2 * MIN + 40 * SEC, false]);
  assert.deepEqual([ended, state.episode, episode.vacated], [false, episode, true], "mehr als 15 Minuten ohne Sichtung, aber locker noch dasselbe");
  const res = track(state, [CAR], t);
  assert.deepEqual([res.reacquired, res.tight, res.episodeEnded], [1, [], false]);
  assert.deepEqual([state.standing[0], state.episode, episode.vacated], [a, episode, undefined]);
});

test("track: verdeckt ist nicht leer – überdeckt eine andere Box das Fahrzeug, wächst seine Leerzeit nicht", () => {
  const state = reportedThenGone(T0 + 20 * MIN);
  const a = state.standing[0];
  // Lieferwagen davor: überdeckt A, Überdeckung unter SAME_VEHICLE_IOU – ein eigenes Fahrzeug.
  const van: NoParkBox = { ...CAR, cls: 7, x: CAR.x - 0.08, y: CAR.y - 0.06, w: 0.2, h: 0.12 };
  assert.ok(overlap(CAR, van) > 0 && overlap(CAR, van) < SAME_VEHICLE_IOU);
  let t = T0 + 20 * MIN;
  for (; t < T0 + 30 * MIN; t += 20 * SEC) track(state, [van], t);
  assert.deepEqual([a.misses, a.missedMs, a.emptyChecks, "gone" in a && a.gone], [30, 0, 0, false]);
  assert.equal(state.standing.length, 1, "der Lieferwagen");
  // Der Lieferwagen fährt weg: A ist dasselbe (nach kurzer Lücke, ohne engere Wiedererkennung).
  const res = track(state, [CAR], t);
  assert.deepEqual([res.reacquired, res.tight], [1, []]);
  assert.equal(state.standing.find((s) => s.firstSeenAt === T0), a);
  // Leer war nur, was keine Box überdeckt: Ein Fahrzeug daneben zählt die Leerzeit weiter.
  const beside = reportedThenGone(T0 + 20 * MIN);
  const other = atFoot(0.86, 0.3, 0.12, 0.0592);
  assert.equal(intersects(CAR, other), false);
  for (let u = T0 + 20 * MIN; u < T0 + 24 * MIN; u += 20 * SEC) track(beside, [other], u);
  assert.equal(beside.lost[0].gone, true);
});

test("coverBoxes: ein Lieferwagen davor verdeckt auch mit Fußpunkt außerhalb der Fläche, kleine Autos dahinter nicht", () => {
  // Lieferwagen auf der Straße davor: Fuß bei (0,7; 0,7), unterhalb der Fläche, ragt über CAR.
  const van = atFoot(0.7, 0.7, 0.3, 0.45, { cls: 7, conf: 0.8 });
  const far = atFoot(0.72, 0.27, 0.05, 0.04);
  const person = { ...van, cls: 0 };
  assert.ok(intersects(CAR, van) && intersects(CAR, far));
  assert.deepEqual(relevantBoxes([van, far, person], ZONE, FILTER), []);
  assert.deepEqual(coverBoxes([van, far, person], FILTER), [van]);
  const covered = reportedThenGone(T0 + 20 * MIN);
  for (let t = T0 + 20 * MIN; t < T0 + 26 * MIN; t += 20 * SEC) track(covered, [], t, { covers: coverBoxes([van, far], FILTER) });
  assert.deepEqual([covered.lost[0].emptyChecks, covered.lost[0].gone], [0, false]);
  const behind = reportedThenGone(T0 + 20 * MIN);
  for (let t = T0 + 20 * MIN; t < T0 + 26 * MIN; t += 20 * SEC) track(behind, [], t, { covers: coverBoxes([far], FILTER) });
  assert.equal(behind.lost[0].gone, true);
});

test("track: Hub 15 Minuten aus (keine Prüfung dazwischen) – eine Box an derselben Stelle übernimmt die Spur ganz", () => {
  const state = reportedThenGone(T0 + 12 * MIN);
  for (let miss = 1; miss <= MAX_MISSES + 1; miss++) track(state, [], T0 + 12 * MIN + miss * 20 * SEC);
  const lostAt = T0 + 12 * MIN + 80 * SEC;
  assert.equal(state.lost[0].lostAt, lostAt);
  // Die Zeit ohne Prüfung zählt nicht als leer: dasselbe Fahrzeug.
  const later = lostAt + 15 * MIN;
  const res = track(state, [CAR], later);
  assert.equal(res.reacquired, 1);
  assert.equal(res.added, 0);
  const v = state.standing[0];
  assert.deepEqual(
    [v.firstSeenAt, v.lastSeenAt, v.reportedAt, v.stored, v.storeTries, v.speaks, v.spokeAt],
    [T0, later, T0 + 2 * MIN, true, 1, 2, T0 + 12 * MIN],
  );
});

test("track: Prüfungen ohne Ergebnis (Tracker weg, Kamera nicht in Grundstellung) zählen nicht als leer", () => {
  const state = reportedThenGone(T0 + 12 * MIN);
  let t = T0 + 12 * MIN;
  for (let i = 0; i < MAX_MISSES + 1; i++) track(state, [], (t += 20 * SEC));
  // 10 Minuten lang jede Prüfung ohne Ergebnis: noteBlind statt track.
  for (let i = 0; i < 30; i++) noteBlind(state);
  t += 10 * MIN;
  assert.equal(track(state, [CAR], t).reacquired, 1);
  assert.equal(state.standing[0].reportedAt, T0 + 2 * MIN);
});

test("track: langer Takt (120 s) – zwei leere Prüfungen bei stehendem Fahrzeug, dasselbe; drei, ein neues (Überdeckung 0,5)", () => {
  const step = 2 * MIN;
  for (const empty of [1, 2, 3]) {
    const state = emptyTrackState();
    let t = T0;
    track(state, [CAR], t);
    state.standing[0].reportedAt = T0;
    state.episode = { startedAt: T0, firstAt: T0, reminders: 0, tries: 0 };
    for (let i = 0; i < empty; i++) track(state, [], (t += step));
    const res = track(state, [HALF], (t += step));
    const same = empty <= SAME_VEHICLE_MAX_EMPTY_CHECKS;
    assert.deepEqual([res.added, res.reacquired, state.standing.length], [same ? 0 : 1, 0, 1], `${empty} leere Prüfungen`);
    assert.equal(state.standing[0].firstSeenAt === T0, same, `${empty} leere Prüfungen`);
  }
});

test("track: gemeldetes Fahrzeug bleibt nach einem Ausfall 3 Stunden gemerkt, ein nicht gemeldetes 15 Minuten", () => {
  assert.equal(REPORTED_MEMORY_MS, 3 * 60 * MIN);
  assert.equal(LOST_MEMORY_MS, 15 * MIN);
  const other = atFoot(0.86, 0.3, 0.12, 0.0592);
  const make = () => {
    const s = emptyTrackState();
    track(s, [CAR, other], T0);
    s.standing[0].reportedAt = T0;
    return s;
  };
  const a = make();
  track(a, [CAR, other], T0 + LOST_MEMORY_MS + SEC);
  assert.deepEqual([a.standing.length, a.standing[0].firstSeenAt, a.standing[1].firstSeenAt], [2, T0, T0 + LOST_MEMORY_MS + SEC]);
  const b = make();
  track(b, [CAR], T0 + REPORTED_MEMORY_MS);
  assert.equal(b.standing[0].firstSeenAt, T0);
  const c = make();
  track(c, [CAR], T0 + REPORTED_MEMORY_MS + 1);
  assert.equal(c.standing[0].firstSeenAt, T0 + REPORTED_MEMORY_MS + 1);
});

test("track: weggefahren bleibt nur mit offenem Eintrag gemerkt, sonst 15 Minuten für die Diagnose", () => {
  const state = emptyTrackState();
  track(state, [CAR], T0);
  Object.assign(state.standing[0], { reportedAt: T0, storeTries: 1, storeKey: `${T0}-0` });
  let t = T0;
  for (; t < T0 + 5 * MIN; t += 20 * SEC) track(state, [], t + 20 * SEC);
  assert.deepEqual([state.lost.length, state.lost[0].gone], [1, true]);
  assert.equal(lostMayReturn(state, t), false);
  // Offener Eintrag: gemerkt, auch nach 15 Minuten.
  track(state, [], T0 + LOST_MEMORY_MS + MIN);
  assert.equal(state.lost.length, 1);
  state.lost[0].stored = true;
  track(state, [], T0 + LOST_MEMORY_MS + 2 * MIN);
  assert.equal(state.lost.length, 0);
});

test("track: neue Box ohne Überdeckung ist ein zweites Fahrzeug mit eigener Standzeit und Kennung", () => {
  const state = emptyTrackState();
  track(state, [CAR], T0);
  const second = atFoot(0.86, 0.3, 0.12, 0.0592);
  const third = atFoot(0.6, 0.3, 0.12, 0.0592);
  track(state, [CAR, second, third], T0 + MIN);
  assert.equal(state.standing.length, 3);
  assert.deepEqual(state.standing.map((s) => s.firstSeenAt), [T0, T0 + MIN, T0 + MIN]);
  // Zwei Fahrzeuge im selben Durchlauf zuerst gesehen: verschiedene Kennungen.
  assert.deepEqual(state.standing.map((s) => s.id), [`${T0}-0`, `${T0 + MIN}-0`, `${T0 + MIN}-1`]);
});

test("track: Episode wartet nach mehr als 3 Minuten beobachteter Leere auf ihr Fahrzeug und endet 15 Minuten nach seiner letzten Sichtung", () => {
  const episode: Episode = { startedAt: T0, firstAt: T0, reminders: 1, tries: 0 };
  const state: TrackState = { ...emptyTrackState(), episode };
  track(state, [CAR], T0);
  state.standing[0].reportedAt = T0;
  let t = T0;
  for (let i = 1; i <= 9; i++) assert.equal(track(state, [], (t += 20 * SEC)).episodeEnded, false);
  assert.deepEqual([state.emptyMs, state.emptyChecks], [SAME_VEHICLE_GAP_MS, 9]);
  assert.equal(state.episode, episode);
  assert.equal(episode.vacated, undefined);
  assert.equal(track(state, [], (t += 20 * SEC)).episodeEnded, false);
  assert.equal(episode.vacated, true, "zu lange leer: wartet nur noch auf das gemeldete Fahrzeug");
  // Danach steht die Leerzeit still: eine leere Fläche ändert sie nicht mehr.
  const frozen = [state.emptyMs, state.emptyChecks];
  while (t < T0 + LOST_MEMORY_MS) assert.equal(track(state, [], (t += 20 * SEC)).episodeEnded, false);
  assert.deepEqual([state.emptyMs, state.emptyChecks], frozen);
  assert.equal(state.episode, episode);
  // 15 Minuten nach der letzten Sichtung kann es nicht mehr zurückkommen: Die Episode endet.
  assert.equal(track(state, [], (t += 20 * SEC)).episodeEnded, true);
  assert.equal(state.episode, null);
  // Eine Box setzt die Leerzeit zurück.
  track(state, [CAR], (t += 20 * SEC));
  assert.deepEqual([state.emptyMs, state.emptyChecks], [0, 0]);
});

test("track: Zeit ohne Beobachtung beendet die Episode nicht", () => {
  const episode = { startedAt: T0, firstAt: T0, reminders: 0, tries: 0 };
  const state: TrackState = { ...emptyTrackState(), episode };
  track(state, [CAR], T0);
  state.standing[0].reportedAt = T0;
  track(state, [], T0 + 20 * SEC);
  // Hub 20 Minuten aus.
  track(state, [], T0 + 20 * MIN);
  assert.equal(state.episode, episode);
  assert.equal(track(state, [CAR], T0 + 20 * MIN + 20 * SEC).reacquired + state.standing.length, 1);
  assert.equal(state.standing[0].firstSeenAt, T0);
});

test("withinSpeakWindow: Tagesfenster, über Mitternacht, gleiche Grenzen = immer", () => {
  assert.equal(withinSpeakWindow(7.99, 8, 22), false);
  assert.equal(withinSpeakWindow(8, 8, 22), true);
  assert.equal(withinSpeakWindow(21.99, 8, 22), true);
  assert.equal(withinSpeakWindow(22, 8, 22), false);
  // Über Mitternacht: 22–6.
  assert.equal(withinSpeakWindow(23.5, 22, 6), true);
  assert.equal(withinSpeakWindow(0, 22, 6), true);
  assert.equal(withinSpeakWindow(5.99, 22, 6), true);
  assert.equal(withinSpeakWindow(6, 22, 6), false);
  assert.equal(withinSpeakWindow(12, 22, 6), false);
  assert.equal(withinSpeakWindow(3, 0, 0), true);
});

test("waitAtMost: wartet höchstens die Frist, ein Fehler zählt als fertig", async () => {
  assert.equal(SPEAK_WAIT_MS, 20_000);
  assert.equal(await waitAtMost(Promise.resolve(1), 1_000), true);
  assert.equal(await waitAtMost(Promise.reject(new Error("Ansage fehlgeschlagen")), 1_000), true);
  const t0 = Date.now();
  assert.equal(await waitAtMost(new Promise(() => {}), 30), false);
  assert.ok(Date.now() - t0 < 1_000);
});

test("runExclusive: ein Durchlauf zur Zeit, ein hängender wird nach der Frist freigegeben und gezählt", async () => {
  assert.equal(STUCK_RUN_MS, 90_000);
  const slot: RunSlot = { current: null };
  const stuck: number[] = [];
  const errors: unknown[] = [];
  let release: () => void = () => {};
  const changes: string[] = [];
  const hanging = runExclusive(
    slot,
    1,
    40,
    async (run) => {
      // Ein Durchlauf, der auf etwas wartet, das nie kommt.
      await new Promise<void>((resolve) => (release = resolve));
      if (run.abandoned) return;
      changes.push("alt");
    },
    (run) => stuck.push(run.startedAt),
    (err) => errors.push(err),
  );
  // Solange er läuft, wird ein zweiter Aufruf übersprungen.
  assert.equal(await runExclusive(slot, 2, 40, async () => void changes.push("zu früh"), () => {}, () => {}), "skipped");
  assert.equal(await hanging, "stuck");
  assert.deepEqual(stuck, [1]);
  assert.equal(slot.current, null);
  // Der nächste läuft, der alte ändert nach seinem Ende nichts mehr.
  assert.equal(await runExclusive(slot, 3, 40, async () => void changes.push("neu"), () => {}, () => {}), "done");
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(changes, ["neu"]);
  assert.equal(slot.current, null);
  assert.deepEqual(errors, []);
});

test("runExclusive: ein Fehler im Durchlauf gibt den Platz frei", async () => {
  const slot: RunSlot = { current: null };
  const errors: string[] = [];
  const res = await runExclusive(
    slot,
    1,
    1_000,
    async () => {
      throw new Error("Snap fehlgeschlagen");
    },
    () => {},
    (err) => errors.push((err as Error).message),
  );
  assert.equal(res, "done");
  assert.deepEqual(errors, ["Snap fehlgeschlagen"]);
  assert.equal(slot.current, null);
});

test("serialQueue: Sichern aus Durchlauf und Beenden überlappt nie, ein Fehler hält das nächste nicht auf", async () => {
  const run = serialQueue();
  const log: string[] = [];
  const job = (name: string, ms: number, fail = false) => () =>
    new Promise<string>((resolve, reject) => {
      log.push(`${name} an`);
      setTimeout(() => {
        log.push(`${name} aus`);
        if (fail) reject(new Error(name));
        else resolve(name);
      }, ms);
    });
  const a = run(job("Durchlauf", 30));
  const b = run(job("Beenden", 5, true));
  const c = run(job("danach", 1));
  assert.equal(await a, "Durchlauf");
  await assert.rejects(b, /Beenden/);
  assert.equal(await c, "danach");
  assert.deepEqual(log, ["Durchlauf an", "Durchlauf aus", "Beenden an", "Beenden aus", "danach an", "danach aus"]);
});

test("finishThenSave: wartet auf den laufenden Durchlauf, sichert danach; ein hängender hält das Sichern nicht auf", async () => {
  const marks: string[] = [];
  const pass = new Promise<void>((resolve) =>
    setTimeout(() => {
      marks.push("zugestellt");
      resolve();
    }, 20),
  );
  assert.equal(
    await finishThenSave(pass, 1_000, async () => {
      marks.push("gesichert");
    }),
    true,
  );
  assert.deepEqual(marks, ["zugestellt", "gesichert"]);

  const started = Date.now();
  let saved = false;
  const finished = await finishThenSave(new Promise(() => {}), 30, async () => {
    saved = true;
  });
  assert.deepEqual([finished, saved], [false, true]);
  assert.ok(Date.now() - started < 1_000);
  assert.equal(await finishThenSave(null, 1_000, async () => {}), true);
});

/* Gleich hohe Boxen, waagrecht um d verschoben: Überdeckung (w − d) / (w + d). Werte als Zweierbrüche, damit die Grenzen genau treffen. */
const shifted = (w: number, d: number, o: Partial<NoParkBox> = {}): [NoParkBox, NoParkBox] => [
  { cls: 2, conf: 0.6, x: 0.1, y: 0.25, w, h: 0.25, ...o },
  { cls: 2, conf: 0.5, x: 0.1 + d, y: 0.25, w, h: 0.25, ...o },
];

test("Grenze Wiedererkennen: ab genau 0,4 dasselbe Fahrzeug, knapp darunter ein neues", () => {
  assert.equal(SAME_VEHICLE_IOU, 0.4);
  const [a, b] = shifted(0.4375, 0.1875);
  const [, c] = shifted(0.4375, 0.1875 + 1 / 1024);
  assert.equal(overlap(a, b), 0.4);
  assert.ok(overlap(a, c) < 0.4);
  // Stehendes Fahrzeug: Box nachgezogen bzw. zweites Fahrzeug.
  const same = emptyTrackState();
  track(same, [a], T0);
  assert.equal(track(same, [b], T0 + 20 * SEC).added, 0);
  const other = emptyTrackState();
  track(other, [a], T0);
  assert.equal(track(other, [c], T0 + 20 * SEC).added, 1);
  // Abgerissene Spur: Übernahme ab genau 0,4.
  const lost = emptyTrackState();
  track(lost, [a], T0);
  for (let miss = 1; miss <= MAX_MISSES + 1; miss++) track(lost, [], T0 + miss * 20 * SEC);
  const copy = structuredClone(lost);
  assert.equal(track(lost, [b], T0 + 2 * MIN).reacquired, 1);
  assert.equal(track(copy, [c], T0 + 2 * MIN).reacquired, 0);
});

test("Grenze Doppelerkennung: ab genau 0,6 eine Box, knapp darunter zwei", () => {
  assert.equal(DUPLICATE_IOU, 0.6);
  const all = parseZone("0,0;1,0;1,1;0,1")!;
  const [a, b] = shifted(0.5, 0.125);
  const [, c] = shifted(0.5, 0.125 + 1 / 1024);
  assert.equal(overlap(a, b), 0.6);
  assert.ok(overlap(a, c) < 0.6);
  assert.deepEqual(relevantBoxes([b, a], all, FILTER), [a]);
  assert.deepEqual(relevantBoxes([c, a], all, FILTER), [a, c]);
});
