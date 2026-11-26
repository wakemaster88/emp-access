import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AttemptImages,
  CAMERA_SPEAK_GAP_MS,
  LOST_MEMORY_MS,
  MAX_MISSES,
  MAX_REPORT_TRIES,
  REMINDER_AFTER_MS,
  REPORTED_MEMORY_MS,
  RETRY_AFTER_MS,
  SAME_SPOT_IOU,
  SAME_VEHICLE_IOU,
  SAVED_STATE_MAX_AGE_MS,
  SECOND_SPEAK_AFTER_MS,
  STATE_REFRESH_MS,
  SPEAKS_PER_VEHICLE,
  applyDelivery,
  applyPlan,
  emptyTrackState,
  evidenceKeyFor,
  hasTrackState,
  needsCloud,
  noteBlind,
  observedGapLimitMs,
  overlap,
  parseTrackStates,
  planReport,
  reportKeys,
  retryDelayMs,
  saveDue,
  serializeTrackStates,
  track,
  type Episode,
  type NoParkBox,
  type ReportConfig,
  type ReportPlan,
  type TrackState,
} from "./noparking-rules.js";

/*
 * Zusage an den Betreiber (Entscheidung vom 25.11.2026): Ansage höchstens
 * zweimal je Fahrzeug, Push beim ersten Fahrzeug und Erinnerungen nach 30, 60
 * und 120 Minuten, zwischen 22 und 7 Uhr keine Nachricht, ein Bild je
 * Fahrzeug. Jeder Satz hat hier seinen Test; die Uhr ist die Berliner
 * Wanduhr (November: UTC+1).
 */

const SEC = 1_000;
const MIN = 60_000;
const STEP = 20 * SEC;

/** Berliner Wanduhr am 06.11.2026 (MEZ) als Zeitstempel; `day` verschiebt um Tage. */
const at = (hh: number, mm = 0, day = 0) => Date.UTC(2026, 10, 6 + day, hh - 1, mm, 0);

const hours = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function cfgAt(now: number, o: Partial<ReportConfig> = {}): ReportConfig {
  const parts = hours.formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return {
    minutes: 2,
    speak: true,
    speakHour: h + m / 60,
    speakFrom: 8,
    speakTo: 22,
    notifyHour: h,
    notifyFrom: 7,
    notifyTo: 22,
    ...o,
  };
}

const car = (fx: number, o: Partial<NoParkBox> = {}): NoParkBox => ({ cls: 2, conf: 0.5, x: fx - 0.06, y: 0.24, w: 0.12, h: 0.06, ...o });
const A = car(0.6);
const B = car(0.75);
const C = car(0.9);
/** Fast an der Stelle von A: Überdeckung 0,85 (ab SAME_SPOT_IOU). */
const A_NEAR = car(0.61);
/** Halb an der Stelle von A: Überdeckung 0,5 (ab SAME_VEHICLE_IOU, unter SAME_SPOT_IOU). */
const A_HALF = car(0.64);
/** Lieferwagen vor A: überdeckt A ganz, Überdeckung (IoU) 0,27 – ein eigenes Fahrzeug. */
const VAN: NoParkBox = { cls: 7, conf: 0.6, x: 0.5, y: 0.2, w: 0.22, h: 0.12 };

interface Step {
  at: number;
  plan: ReportPlan;
  /** Wurde die Cloud gefragt, und mit welchem Ergebnis? */
  cloud: "ok" | "fail" | null;
  /** Gespeicherter Eintrag, dessen Ausschnitt die Cloud mit der ersten Nachricht an Telegram schickt (evidenceKeyFor). */
  evidence: string | null;
}

/**
 * Durchläufe wie in noparking.ts: track, planReport, applyPlan, bei Bedarf
 * die Cloud und applyDelivery. `boxesAt` liefert die Boxen der Fläche je
 * Zeitpunkt, `coversAt` weitere Boxen, die verdecken (coverBoxes), `blindAt`
 * Prüfungen ohne Ergebnis (noteBlind), `cloudOk` die Antwort der Cloud.
 */
function simulate(
  state: TrackState,
  from: number,
  to: number,
  boxesAt: (t: number) => NoParkBox[],
  opts: {
    cloudOk?: (t: number) => boolean;
    cfg?: Partial<ReportConfig>;
    step?: number;
    gapLimitMs?: number;
    coversAt?: (t: number) => NoParkBox[];
    blindAt?: (t: number) => boolean;
  } = {},
): Step[] {
  const steps: Step[] = [];
  for (let t = from; t <= to; t += opts.step ?? STEP) {
    if (opts.blindAt?.(t)) {
      noteBlind(state);
      continue;
    }
    track(state, boxesAt(t), t, { gapLimitMs: opts.gapLimitMs, covers: opts.coversAt?.(t) });
    const plan = planReport(state, t, cfgAt(t, opts.cfg));
    applyPlan(state, plan, t);
    let cloud: Step["cloud"] = null;
    let evidence: string | null = null;
    if (needsCloud(plan)) {
      evidence = evidenceKeyFor(state, plan);
      const ok = opts.cloudOk ? opts.cloudOk(t) : true;
      applyDelivery(state, plan, ok, t);
      cloud = ok ? "ok" : "fail";
    }
    steps.push({ at: t, plan, cloud, evidence });
  }
  return steps;
}

const clock = (t: number) => hours.format(new Date(t));
const speaks = (steps: Step[]) => steps.filter((s) => s.plan.speak).map((s) => clock(s.at));
const messages = (steps: Step[]) =>
  steps
    .filter((s) => s.plan.notify && s.cloud === "ok")
    .map((s) => `${clock(s.at)} ${s.plan.notify!.kind === "first" ? "erste" : `Erinnerung ${(s.plan.notify as { n: number }).n}`} (${s.plan.inZone})`);
const stores = (steps: Step[]) => steps.filter((s) => s.plan.store.length > 0 && s.cloud === "ok").map((s) => `${clock(s.at)} ×${s.plan.store.length}`);

test("Konstanten der Zusage", () => {
  assert.equal(SPEAKS_PER_VEHICLE, 2);
  assert.equal(SECOND_SPEAK_AFTER_MS, 10 * MIN);
  assert.equal(CAMERA_SPEAK_GAP_MS, 5 * MIN);
  assert.deepEqual(REMINDER_AFTER_MS, [30 * MIN, 60 * MIN, 120 * MIN]);
  assert.equal(MAX_REPORT_TRIES, 5);
});

test("Testboxen: Überdeckung mit A", () => {
  assert.ok(overlap(A, A_NEAR) >= SAME_SPOT_IOU);
  assert.ok(Math.abs(overlap(A, A_HALF) - 0.5) < 1e-9);
  assert.ok(overlap(A, VAN) > 0 && overlap(A, VAN) < SAME_VEHICLE_IOU);
});

test("Ansage höchstens zweimal je Fahrzeug: beim Erreichen der Schwelle und 10 Minuten später", () => {
  const steps = simulate(emptyTrackState(), at(12), at(15), () => [A]);
  assert.deepEqual(speaks(steps), ["12:02", "12:12"]);
});

test("Ansage frühestens 5 Minuten nach der letzten Ansage an derselben Kamera", () => {
  // A ab 12:00 (fällig 12:02), B ab 12:01 (fällig 12:03).
  const steps = simulate(emptyTrackState(), at(12), at(13), (t) => (t >= at(12, 1) ? [A, B] : [A]));
  assert.deepEqual(speaks(steps), ["12:02", "12:07", "12:12", "12:17"]);
  const who = steps.filter((s) => s.plan.speak).map((s) => s.plan.speakFor.map((v) => v.box.x.toFixed(2)).join("+"));
  assert.deepEqual(who, ["0.54", "0.69", "0.54", "0.69"]);
});

test("Ansage nur im Ansage-Fenster: nachts still, morgens die ausstehenden Ansagen", () => {
  // Fällig 21:57: erste Ansage; die zweite (22:07) fällt in die Nacht und kommt um 8 Uhr.
  const evening = simulate(emptyTrackState(), at(21, 55), at(8, 30, 1), () => [A], { step: MIN });
  assert.deepEqual(speaks(evening), ["21:57", "08:00"]);
  // Ankunft um 23 Uhr: keine Ansage in der Nacht, um 8:00 und 8:10.
  const night = simulate(emptyTrackState(), at(23), at(9, 0, 1), () => [A], { step: MIN });
  assert.deepEqual(speaks(night), ["08:00", "08:10"]);
  // Ansage abgeschaltet (HUB_NOPARK_SPEAK=0): nie.
  assert.deepEqual(speaks(simulate(emptyTrackState(), at(12), at(13), () => [A], { cfg: { speak: false } })), []);
});

test("Nachricht beim ersten Fahrzeug, Erinnerungen nach 30, 60 und 120 Minuten, danach keine", () => {
  const steps = simulate(emptyTrackState(), at(12), at(17), () => [A]);
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:32 Erinnerung 1 (1)", "13:02 Erinnerung 2 (1)", "14:02 Erinnerung 3 (1)"]);
});

test("Ein weiteres Fahrzeug in derselben Episode: keine eigene Nachricht, die Erinnerung nennt die Zahl", () => {
  // A ab 12:00, B ab 12:10 (fällig 12:12), C ab 12:40.
  const steps = simulate(emptyTrackState(), at(12), at(13, 10), (t) => [A, ...(t >= at(12, 10) ? [B] : []), ...(t >= at(12, 40) ? [C] : [])]);
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:32 Erinnerung 1 (2)", "13:02 Erinnerung 2 (3)"]);
  // Jedes Fahrzeug hat genau einen Eintrag in der Historie.
  assert.deepEqual(stores(steps), ["12:02 ×1", "12:12 ×1", "12:42 ×1"]);
});

test("Zwischen 22 und 7 Uhr keine Nachricht: weder die erste noch eine Erinnerung", () => {
  // Fällig um 23:02: Historie ja, Nachricht nein; steht es um 7 Uhr noch, geht die erste dann hinaus.
  const steps = simulate(emptyTrackState(), at(23), at(9, 0, 1), () => [A], { step: MIN });
  assert.deepEqual(stores(steps), ["23:02 ×1"]);
  // Die Erinnerungen zählen ab der zugestellten ersten Nachricht.
  assert.deepEqual(messages(steps), ["07:00 erste (1)", "07:30 Erinnerung 1 (1)", "08:00 Erinnerung 2 (1)", "09:00 Erinnerung 3 (1)"]);
  // Fährt es vor 7 Uhr weg: keine Nachricht, nur der Eintrag in der Historie.
  const gone = simulate(emptyTrackState(), at(23), at(9, 0, 1), (t) => (t < at(5, 0, 1) ? [A] : []), { step: MIN });
  assert.deepEqual(messages(gone), []);
  assert.deepEqual(stores(gone), ["23:02 ×1"]);
});

test("Ein Fahrzeug steht 3 Stunden über 22 Uhr hinweg: Erinnerung in der Nacht entfällt", () => {
  const steps = simulate(emptyTrackState(), at(20, 30), at(23, 30), () => [A]);
  assert.deepEqual(speaks(steps), ["20:32", "20:42"]);
  assert.deepEqual(messages(steps), ["20:32 erste (1)", "21:02 Erinnerung 1 (1)", "21:32 Erinnerung 2 (1)"]);
  const skipped = steps.filter((s) => s.plan.skipReminder > 0).map((s) => `${clock(s.at)} ${s.plan.skipReminder}`);
  assert.deepEqual(skipped, ["22:32 3"]);
  assert.deepEqual(stores(steps), ["20:32 ×1"]);
  // Am nächsten Morgen nichts mehr: Die Erinnerungen der Episode sind erledigt.
  const state = emptyTrackState();
  simulate(state, at(20, 30), at(23, 30), () => [A]);
  assert.deepEqual(messages(simulate(state, at(23, 30), at(9, 0, 1), () => [A], { step: MIN })), []);
});

test("Nachrichten-Fenster über Mitternacht (z. B. 20–6 Uhr)", () => {
  const night = { notifyFrom: 20, notifyTo: 6 };
  assert.deepEqual(messages(simulate(emptyTrackState(), at(23), at(23, 5), () => [A], { cfg: night })), ["23:02 erste (1)"]);
  assert.deepEqual(messages(simulate(emptyTrackState(), at(12), at(12, 5), () => [A], { cfg: night })), []);
});

test("Ein Bild je Fahrzeug: Eintrag in der Historie nur bei der ersten Meldung", () => {
  // Ein Fahrzeug, 3 Stunden: genau ein Eintrag.
  const steps = simulate(emptyTrackState(), at(12), at(15), () => [A]);
  assert.deepEqual(stores(steps), ["12:02 ×1"]);
  // Erinnerungen gehen ohne Eintrag in der Historie hinaus.
  assert.ok(steps.filter((s) => s.plan.notify?.kind === "reminder").every((s) => s.plan.store.length === 0));
});

test("Spur fehlt 5 Durchläufe und kommt zurück: keine zweite Erstmeldung", () => {
  const state = emptyTrackState();
  const steps = simulate(state, at(12), at(12, 30), (t) => (t > at(12, 5) && t <= at(12, 5) + 5 * STEP ? [] : [A]));
  assert.deepEqual(stores(steps), ["12:02 ×1"]);
  assert.deepEqual(messages(steps), ["12:02 erste (1)"]);
  assert.deepEqual(speaks(steps), ["12:02", "12:12"]);
});

test("Zwei Fahrzeuge nacheinander mit leerer Fläche dazwischen: zwei Episoden mit je einer ersten Nachricht", () => {
  const steps = simulate(emptyTrackState(), at(12), at(13, 30), (t) => (t < at(12, 20) ? [A] : t >= at(12, 40) ? [B] : []));
  // A ist um 12:20 fort: keine Erinnerung für A um 12:32; B bekommt seine eigene.
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:42 erste (1)", "13:12 Erinnerung 1 (1)"]);
  assert.deepEqual(stores(steps), ["12:02 ×1", "12:42 ×1"]);
  assert.deepEqual(speaks(steps), ["12:02", "12:12", "12:42", "12:52"]);
});

test("Anderes Fahrzeug halb an derselben Stelle (Überdeckung 0,5) nach 10 Minuten beobachtet leerer Fläche: neues Fahrzeug, eigene Meldung, nichts geerbt", () => {
  const state = emptyTrackState();
  const steps = simulate(state, at(12), at(13), (t) => (t < at(12, 20) ? [A] : t >= at(12, 30) ? [A_HALF] : []));
  assert.deepEqual(stores(steps), ["12:02 ×1", "12:32 ×1"]);
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:32 erste (1)"]);
  assert.deepEqual(speaks(steps), ["12:02", "12:12", "12:32", "12:42"]);
  const [v] = state.standing;
  assert.deepEqual([v.firstSeenAt, v.id, v.storeKey], [at(12, 30), `${at(12, 30)}-0`, `${at(12, 30)}-0`]);
  assert.equal(state.episode!.startedAt, at(12, 32));
});

test("Dieselbe Box erst 16 Minuten nach der letzten Sichtung: neues Fahrzeug mit eigener Meldung (engere Wiedererkennung nur 15 Minuten)", () => {
  const state = emptyTrackState();
  // A zuletzt 12:19:40, wieder ab 12:36.
  const steps = simulate(state, at(12), at(13), (t) => (t < at(12, 20) || t >= at(12, 36) ? [A] : []));
  assert.deepEqual(stores(steps), ["12:02 ×1", "12:38 ×1"]);
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:38 erste (1)"]);
  assert.deepEqual(speaks(steps), ["12:02", "12:12", "12:38", "12:48"]);
});

// Zuletzt gesehen 12:30:40; dasselbe Fahrzeug, solange es nach höchstens 3 Minuten beobachtet leer wieder da ist.
for (const hidden of [60, 160]) {
  test(`Ohne Box ab 12:31 für ${hidden} s: dasselbe Fahrzeug, keine zweite Erstmeldung, kein zweiter Eintrag`, () => {
    const from = at(12, 31);
    const steps = simulate(emptyTrackState(), at(12), at(13), (t) => (t >= from && t < from + hidden * SEC ? [] : [A]));
    assert.deepEqual(stores(steps), ["12:02 ×1"]);
    // Die Erinnerung nach 30 Minuten kommt, sobald das Fahrzeug wieder zu sehen ist.
    assert.deepEqual(messages(steps), ["12:02 erste (1)", `${clock(Math.max(at(12, 32), from + hidden * SEC))} Erinnerung 1 (1)`]);
    assert.deepEqual(speaks(steps), ["12:02", "12:12"]);
  });
}

// Erkennung setzt aus (Dämmerung, Regen): Die Fläche ist beobachtet leer, länger als die kurze Lücke.
for (const hidden of [4, 6, 10]) {
  test(`Erkennung setzt ab 12:30 für ${hidden} Minuten aus: dieselbe Box gilt als dasselbe Fahrzeug – 2 Ansagen, eine erste Nachricht, ein Bild`, () => {
    const back = at(12, 30 + hidden);
    const state = emptyTrackState();
    const steps = simulate(state, at(12), at(13), (t) => (t >= at(12, 30) && t < back ? [] : [A]));
    assert.deepEqual(stores(steps), ["12:02 ×1"]);
    // Die Erinnerung nach 30 Minuten kommt, sobald das Fahrzeug wieder zu sehen ist.
    assert.deepEqual(messages(steps), ["12:02 erste (1)", `${clock(back)} Erinnerung 1 (1)`]);
    assert.deepEqual(speaks(steps), ["12:02", "12:12"]);
    assert.deepEqual([state.standing.length, state.standing[0].firstSeenAt], [1, at(12)]);
  });
}

test("Lieferwagen verdeckt A 5 Minuten: A behält 2 Ansagen und ein Bild, der Lieferwagen ist ein eigenes Fahrzeug", () => {
  const state = emptyTrackState();
  const boxesAt = (t: number) => (t >= at(12, 15) && t < at(12, 20) ? [VAN] : [A]);
  const steps = simulate(state, at(12), at(12, 30), boxesAt);
  const a = state.standing.find((v) => v.firstSeenAt === at(12))!;
  assert.deepEqual([state.standing.length, a.speaks, a.stored, a.storeKey], [1, 2, true, `${at(12)}-0`]);
  const van = state.lost.find((v) => v.firstSeenAt === at(12, 15))!;
  assert.deepEqual([van.speaks, van.stored, van.storeKey], [1, true, `${at(12, 15)}-0`]);
  steps.push(...simulate(state, at(12, 30) + STEP, at(12, 45), boxesAt));
  // A: 12:02 und 12:12; der Lieferwagen 12:17 (er fährt vor seiner zweiten).
  assert.deepEqual(speaks(steps), ["12:02", "12:12", "12:17"]);
  assert.deepEqual(stores(steps), ["12:02 ×1", "12:17 ×1"]);
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:32 Erinnerung 1 (1)"]);
  // A überdeckt die Stelle des Lieferwagens; 15 Minuten nach seiner letzten Sichtung ist er trotzdem vergessen.
  assert.equal(state.lost.length, 0);
});

/** Nachbar von A, seine Box überlappt die von A (Überdeckung 0,04, aber Schnittfläche). */
const A_NEXT = car(0.71);

test("Nachbar überlappt A, A fährt weg: 10 Minuten später übernimmt C an der Stelle noch A, 20 Minuten später ist C ein eigenes Fahrzeug", () => {
  assert.ok(overlap(A, A_NEXT) > 0 && overlap(A, A_NEXT) < SAME_VEHICLE_IOU && overlap(A_HALF, A_NEXT) < SAME_VEHICLE_IOU);
  // A 12:00–12:10, B (Nachbar) ab 12:01 durchgehend, C ab `cFrom` halb an der Stelle von A (Überdeckung 0,5).
  const run = (cFrom: number) => {
    const state = emptyTrackState();
    const steps = simulate(state, at(12), at(12, 50), (t) => [
      ...(t < at(12, 10) ? [A] : []),
      ...(t >= at(12, 1) ? [A_NEXT] : []),
      ...(t >= cFrom ? [A_HALF] : []),
    ]);
    return { state, steps };
  };
  // Nach 10 Minuten: A ist verdeckt nicht leer und noch dasselbe – C übernimmt seine Spur.
  const early = run(at(12, 20));
  assert.deepEqual(stores(early.steps), ["12:02 ×1", "12:03 ×1"]);
  assert.ok(early.state.standing.some((v) => v.firstSeenAt === at(12) && v.lastSeenAt === at(12, 50)));
  // Nach 20 Minuten ohne eigene Sichtung: nicht mehr übernehmbar, C hat eigenen Eintrag und eigene Ansagen.
  const { state, steps } = run(at(12, 30));
  assert.deepEqual(stores(steps), ["12:02 ×1", "12:03 ×1", "12:32 ×1"]);
  // A 12:02 (fort vor seiner zweiten), B 12:07 und 12:17, C 12:32 und 12:42.
  assert.deepEqual(speaks(steps), ["12:02", "12:07", "12:17", "12:32", "12:42"]);
  // Dieselbe Episode (B steht durchgehend): keine zweite Erstmeldung; die Erinnerung zählt B und C, nicht das unsichtbare A.
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:32 Erinnerung 1 (2)"]);
  const c = state.standing.find((v) => v.firstSeenAt === at(12, 30))!;
  assert.deepEqual([c.id, c.storeKey, c.reportedAt, c.speaks], [`${at(12, 30)}-0`, `${at(12, 30)}-0`, at(12, 32), 2]);
  assert.equal([...state.standing, ...state.lost].some((v) => v.firstSeenAt === at(12)), false, "A ist vergessen");
});

/*
 * Lieferwagen auf der Straße vor A (VAN, Fußpunkt außerhalb der Fläche): Er
 * ist keine Box der Fläche, verdeckt A aber (coverBoxes). Die Fläche gilt als
 * leer, die Episode wartet nach 3 Minuten nur noch auf A.
 */
const STREET_VAN_FROM = at(12, 20);
const onStreet = (until: number) => (t: number) => (t >= STREET_VAN_FROM && t < until ? [VAN] : []);

test("Lieferwagen verdeckt A 15,5 Minuten, davon 2 Minuten ohne Ergebnis: A ist noch dasselbe, eine erste Nachricht, kein zweiter Ausschnitt", () => {
  // A ab 12:00 (gemeldet 12:02), verdeckt 12:20–12:35:30; 12:22–12:24 Kamera nicht in Grundstellung.
  const until = at(12, 35) + 30 * SEC;
  const covers = onStreet(until);
  const state = emptyTrackState();
  const steps = simulate(state, at(12), at(12, 50), (t) => (covers(t).length > 0 ? [] : [A]), {
    coversAt: covers,
    blindAt: (t) => t >= at(12, 22) && t < at(12, 24),
  });
  assert.equal(state.episode?.startedAt, at(12, 2), "die Episode läuft weiter");
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:35 Erinnerung 1 (1)"]);
  assert.deepEqual(stores(steps), ["12:02 ×1"]);
  assert.deepEqual(speaks(steps), ["12:02", "12:12"]);
  assert.deepEqual(steps.filter((s) => s.evidence !== null), [], "kein gespeicherter Ausschnitt an Telegram");
  assert.deepEqual([state.standing.length, state.standing[0].firstSeenAt], [1, at(12)]);
});

test("Lieferwagen verdeckt A 15,5 Minuten, Hub-Neustart nach 2 Minuten: A ist noch dasselbe, eine erste Nachricht, kein zweiter Ausschnitt", () => {
  const until = at(12, 35) + 30 * SEC;
  const covers = onStreet(until);
  const boxesAt = (t: number) => (covers(t).length > 0 ? [] : [A]);
  const before = emptyTrackState();
  const steps = simulate(before, at(12), at(12, 25) - STEP, boxesAt, { coversAt: covers });
  // Hub um 12:25 aus, 12:27 wieder an.
  const loaded = parseTrackStates(serializeTrackStates(new Map([[9, before]]), at(12, 25)), at(12, 27)).get(9)!;
  steps.push(...simulate(loaded, at(12, 27), at(12, 50), boxesAt, { coversAt: covers }));
  assert.equal(loaded.episode?.startedAt, at(12, 2), "die Episode läuft weiter");
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:35 Erinnerung 1 (1)"]);
  assert.deepEqual(stores(steps), ["12:02 ×1"]);
  assert.deepEqual(steps.filter((s) => s.evidence !== null), [], "kein gespeicherter Ausschnitt an Telegram");
  assert.deepEqual([loaded.standing.length, loaded.standing[0].firstSeenAt], [1, at(12)]);
});

test("Lieferwagen verdeckt A, daneben wird B fällig und fährt weg: B bekommt seine Episode, A danach keine zweite erste Nachricht", () => {
  // A ab 12:00 (gemeldet 12:02), verdeckt 12:20–12:34; B 12:24–12:27 an anderer Stelle (fällig 12:26).
  const covers = onStreet(at(12, 34));
  const state = emptyTrackState();
  const steps = simulate(
    state,
    at(12),
    at(13),
    (t) => [...(covers(t).length > 0 ? [] : [A]), ...(t >= at(12, 24) && t < at(12, 27) ? [B] : [])],
    { coversAt: covers },
  );
  // A 12:02, B 12:26 (eigene Episode, die Fläche war leer); A ab 12:34 wieder zu sehen: nur die
  // nächste fällige Erinnerung der laufenden Episode (30 Minuten nach 12:26).
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:26 erste (1)", "12:56 Erinnerung 1 (1)"]);
  assert.deepEqual(stores(steps), ["12:02 ×1", "12:26 ×1"]);
  assert.deepEqual(steps.filter((s) => s.evidence !== null), [], "kein gespeicherter Ausschnitt an Telegram");
  assert.deepEqual(steps.filter((s) => s.plan.opensEpisode).map((s) => clock(s.at)), ["12:02", "12:26"]);
  const a = state.standing.find((v) => v.firstSeenAt === at(12))!;
  assert.deepEqual([a.reportedAt, a.stored, a.storeKey], [at(12, 2), true, `${at(12)}-0`]);
});

test("Ein anderes Fahrzeug an anderer Stelle nach leerer Fläche: eigene erste Nachricht, auch solange das erste gemerkt ist", () => {
  // A bis 12:20, B ab 12:26 (fällig 12:28): A ist noch gemerkt, die Episode ruht.
  const steps = simulate(emptyTrackState(), at(12), at(13), (t) => (t < at(12, 20) ? [A] : t >= at(12, 26) ? [B] : []));
  assert.deepEqual(messages(steps), ["12:02 erste (1)", "12:28 erste (1)", "12:58 Erinnerung 1 (1)"]);
  assert.deepEqual(stores(steps), ["12:02 ×1", "12:28 ×1"]);
});

test("Neustart mitten in einer Episode: Zustand aus der Datei, keine zweite Erstmeldung", () => {
  const before = emptyTrackState();
  const first = simulate(before, at(12), at(12, 40), () => [A]);
  assert.deepEqual(messages(first), ["12:02 erste (1)", "12:32 Erinnerung 1 (1)"]);
  const file = serializeTrackStates(new Map([[9, before]]), at(12, 40));
  // Neustart: 2 Minuten ohne Durchlauf, dann wie vorher.
  const loaded = parseTrackStates(file, at(12, 42)).get(9)!;
  assert.ok(loaded);
  const after = simulate(loaded, at(12, 42), at(13, 30), () => [A]);
  assert.deepEqual(stores(after), []);
  assert.deepEqual(speaks(after), []);
  assert.deepEqual(messages(after), ["13:02 Erinnerung 2 (1)"]);
});

test("Erinnerung nur, solange ein Fahrzeug steht", () => {
  // A bis 12:31 (zuletzt 12:30:40), Erinnerung fällig 12:32: A fehlt, die Episode läuft noch.
  const steps = simulate(emptyTrackState(), at(12), at(12, 45), (t) => (t <= at(12, 30, 0) + 2 * STEP ? [A] : []));
  assert.deepEqual(messages(steps), ["12:02 erste (1)"]);
  assert.ok(steps.every((s) => s.plan.notify?.kind !== "reminder"));
});

test("Gescheiterte erste Nachricht wird wiederholt, auch wenn das Fahrzeug inzwischen fort ist", () => {
  // A ist nur bis zur Fälligkeit zu sehen; der erste Versuch scheitert.
  const steps = simulate(emptyTrackState(), at(12), at(12, 10), (t) => (t <= at(12, 2) ? [A] : []), {
    cloudOk: (t) => t > at(12, 2),
  });
  assert.deepEqual(calls(steps), ["12:02:00 fail", "12:02:20 ok"]);
  const retry = steps.find((s) => s.at === at(12, 2) + STEP)!;
  assert.deepEqual([retry.plan.notify, retry.plan.inZone, retry.plan.store.length], [{ kind: "first" }, 0, 1]);
});

test("Erinnerung in der Nacht entfällt und beendet auch ihre offenen Versuche", () => {
  const state = emptyTrackState();
  track(state, [A], at(21));
  Object.assign(state.standing[0], { firstSeenAt: at(19), reportedAt: at(21, 20), stored: true });
  state.episode = { startedAt: at(21, 20), firstAt: at(21, 20), reminders: 0, tries: 2 };
  state.retryAt = at(21, 59);
  track(state, [A], at(22));
  const plan = planReport(state, at(22), cfgAt(at(22)));
  assert.deepEqual([plan.notify, plan.skipReminder, needsCloud(plan)], [null, 1, false]);
  applyPlan(state, plan, at(22));
  assert.deepEqual([state.episode.reminders, state.episode.tries], [1, 0]);
});

test("Ansage-Sperre je Kamera gilt über einen Neustart hinweg", () => {
  // A ab 12:00 (Ansage 12:02), Neustart 12:03, B ab 12:03 (fällig 12:05): Ansage für B erst 12:07.
  const before = emptyTrackState();
  simulate(before, at(12), at(12, 3) - STEP, () => [A]);
  assert.equal(before.lastSpeakAt, at(12, 2));
  const loaded = parseTrackStates(serializeTrackStates(new Map([[9, before]]), at(12, 3) - STEP), at(12, 3)).get(9)!;
  assert.equal(loaded.lastSpeakAt, at(12, 2));
  const after = simulate(loaded, at(12, 3), at(12, 10), () => [A, B]);
  assert.deepEqual(speaks(after), ["12:07"]);
});

test("Gesicherter Zustand: Episode, abgerissenes gemeldetes Fahrzeug und Zeitpunkt des nächsten Versuchs überstehen den Neustart", () => {
  const s = emptyTrackState();
  track(s, [A], at(12));
  s.standing[0].reportedAt = at(12, 2);
  for (let i = 1; i <= MAX_MISSES + 1; i++) track(s, [], at(12, 5) + i * STEP);
  const ep = { startedAt: at(12, 2), firstAt: at(12, 2), reminders: 0, tries: 0 };
  s.episode = ep;
  s.retryAt = at(12, 9);
  const file = serializeTrackStates(new Map([[9, s]]), at(12, 8));
  const loaded = parseTrackStates(file, at(12, 8) + 30 * SEC).get(9)!;
  assert.deepEqual([loaded.episode, loaded.retryAt, loaded.lost.length, loaded.lost[0].gone], [ep, at(12, 9), 1, false]);
  // Die Zeit bis zur ersten Prüfung nach dem Neustart zählt nicht als leer.
  assert.deepEqual([loaded.blind, loaded.lastCheckAt], [true, 0]);
  // Ein gemeldetes Fahrzeug bleibt REPORTED_MEMORY_MS nach der letzten Sichtung gemerkt, mit seiner Episode.
  const late = parseTrackStates(file, at(12) + REPORTED_MEMORY_MS).get(9)!;
  assert.deepEqual([late.episode, late.lost.length], [ep, 1]);
  assert.equal(parseTrackStates(file, at(12) + REPORTED_MEMORY_MS + 1).size, 0);
  // Ein nicht gemeldetes nur LOST_MEMORY_MS; danach bleibt von der Kamera nichts.
  s.lost[0].reportedAt = 0;
  const unreported = serializeTrackStates(new Map([[9, s]]), at(12, 8));
  assert.equal(parseTrackStates(unreported, at(12) + LOST_MEMORY_MS).get(9)!.lost.length, 1);
  assert.equal(parseTrackStates(unreported, at(12, 8) + SAVED_STATE_MAX_AGE_MS + 1).get(9), undefined);
});

test("Gesicherter Zustand: Höchstalter, Unsinn und Zukunft werden verworfen", () => {
  const s = emptyTrackState();
  track(s, [A], at(12));
  const file = serializeTrackStates(new Map([[9, s]]), at(12));
  assert.equal(parseTrackStates(file, at(12) + SAVED_STATE_MAX_AGE_MS).size, 1);
  assert.equal(parseTrackStates(file, at(12) + SAVED_STATE_MAX_AGE_MS + 1).size, 0);
  assert.equal(parseTrackStates(file, at(12) - 5 * MIN).size, 0);
  assert.equal(parseTrackStates("", at(12)).size, 0);
  assert.equal(parseTrackStates("{kaputt", at(12)).size, 0);
  assert.equal(parseTrackStates(JSON.stringify({ v: 2, savedAt: at(12), cameras: {} }), at(12)).size, 0);
  const odd = JSON.stringify({
    v: 1,
    savedAt: at(12),
    cameras: { "9": { standing: [{ box: { w: 0 } }, null, 5], lost: [{ ...s.standing[0], lostAt: at(11) }], episode: { startedAt: -1 } }, x: {} },
  });
  const parsed = parseTrackStates(odd, at(12));
  assert.deepEqual([...parsed.keys()], [9]);
  assert.deepEqual(parsed.get(9), {
    standing: [],
    lost: [],
    episode: null,
    lastSpeakAt: 0,
    retryAt: 0,
    lastCheckAt: 0,
    blind: true,
    emptyMs: 0,
    emptyChecks: 0,
  });
});

const stamp = (t: number) => `${clock(t)}:${String(new Date(t).getUTCSeconds()).padStart(2, "0")}`;
const calls = (steps: Step[]) => steps.filter((s) => s.cloud).map((s) => `${stamp(s.at)} ${s.cloud}`);

test("Abstand der Versuche: der zweite im nächsten Durchlauf, dann wachsend", () => {
  assert.deepEqual(RETRY_AFTER_MS, [0, 90 * SEC, 8 * MIN, 20 * MIN]);
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelayMs), [0, 0, 90 * SEC, 8 * MIN, 20 * MIN, 20 * MIN]);
});

test("Sichern: nicht vor dem Laden, bei Änderung, unverändert nach 5 Minuten oder beim Beenden", () => {
  assert.equal(STATE_REFRESH_MS, 5 * MIN);
  const base = { loaded: true, key: "a", savedKey: "a", savedAt: at(12), now: at(12, 1), hasState: true, force: false };
  // Vor dem Laden der Datei nie, auch nicht beim Beenden: sonst wäre sie leer überschrieben.
  assert.equal(saveDue({ ...base, loaded: false, key: "b", force: true }), false);
  assert.equal(saveDue({ ...base, key: "b" }), true);
  assert.equal(saveDue(base), false);
  assert.equal(saveDue({ ...base, now: at(12) + STATE_REFRESH_MS - 1 }), false);
  assert.equal(saveDue({ ...base, now: at(12) + STATE_REFRESH_MS }), true);
  assert.equal(saveDue({ ...base, force: true }), true);
  // Leer und unverändert: nichts zu schreiben, auch beim Beenden nicht.
  assert.equal(saveDue({ ...base, hasState: false, force: true, now: at(13) }), false);
  const s = emptyTrackState();
  assert.equal(hasTrackState([s]), false);
  assert.equal(hasTrackState([s, { ...emptyTrackState(), episode: { startedAt: 1, firstAt: 1, reminders: 0, tries: 0 } }]), true);
  track(s, [A], at(12));
  assert.equal(hasTrackState([s]), true);
});

test("Tracker 25 Minuten weg, Neustart mittendrin: Zustand bleibt frisch, keine zweite Erstmeldung", () => {
  // Wie noparking.ts: jeder Durchlauf sichert (saveDue), auch wenn der Tracker
  // kein Ergebnis liefert und track nicht läuft; beim Beenden mit force.
  let states = new Map([[9, emptyTrackState()]]);
  let file = "";
  let savedKey = "";
  let savedAt = 0;
  const save = (now: number, force = false) => {
    const key = serializeTrackStates(states, 0);
    if (!saveDue({ loaded: true, key, savedKey, savedAt, now, hasState: hasTrackState(states.values()), force })) return;
    file = serializeTrackStates(states, now);
    savedKey = key;
    savedAt = now;
  };
  const firsts: string[] = [];
  const pass = (t: number, trackerUp: boolean) => {
    const st = states.get(9)!;
    if (trackerUp) {
      track(st, [A], t);
      const plan = planReport(st, t, cfgAt(t));
      applyPlan(st, plan, t);
      if (plan.notify?.kind === "first") firsts.push(clock(t));
      if (needsCloud(plan)) applyDelivery(st, plan, true, t);
    } else noteBlind(st);
    save(t);
  };
  let t = at(12);
  for (; t < at(12, 5); t += STEP) pass(t, true);
  for (; t < at(12, 25); t += STEP) pass(t, false);
  save(t, true); // geordnetes Beenden um 12:25
  const loaded = parseTrackStates(file, t + 10 * SEC);
  assert.equal(loaded.get(9)?.standing.length, 1);
  states = new Map([[9, loaded.get(9)!]]);
  for (t += 10 * SEC; t < at(12, 30); t += STEP) pass(t, false);
  for (; t < at(12, 40); t += STEP) pass(t, true);
  assert.deepEqual(firsts, ["12:02"]);
});

test("Cloud antwortet dreimal mit Fehler: Meldung wird wiederholt, Ansage nie", () => {
  let failed = 0;
  const steps = simulate(emptyTrackState(), at(12), at(12, 50), () => [A], { cloudOk: () => ++failed > 3 });
  assert.deepEqual(calls(steps).slice(0, 4), ["12:02:00 fail", "12:02:20 fail", "12:04:00 fail", "12:12:00 ok"]);
  // Die Ansage kam einmal, beim ersten Versuch.
  assert.deepEqual(speaks(steps), ["12:02", "12:12"]);
  assert.deepEqual(stores(steps), ["12:12 ×1"]);
  // Erinnerungen zählen ab der zugestellten ersten Nachricht.
  assert.deepEqual(messages(steps), ["12:12 erste (1)", "12:42 Erinnerung 1 (1)"]);
});

test("Internet 3 Minuten weg: Eintrag in der Historie und erste Nachricht kommen danach an", () => {
  // Fahrzeug 12:00–12:20, keine Verbindung 12:01–12:04.
  const up = (t: number) => !(t >= at(12, 1) && t < at(12, 4));
  const steps = simulate(emptyTrackState(), at(12), at(12, 40), (t) => (t < at(12, 20) ? [A] : []), { cloudOk: up });
  assert.deepEqual(calls(steps), ["12:02:00 fail", "12:02:20 fail", "12:04:00 ok"]);
  assert.deepEqual(stores(steps), ["12:04 ×1"]);
  assert.deepEqual(messages(steps), ["12:04 erste (1)"]);
});

test("Cloud 25 Minuten weg: der fünfte Versuch nach rund 30 Minuten kommt noch an", () => {
  const up = (t: number) => t >= at(12, 27);
  const steps = simulate(emptyTrackState(), at(12), at(12, 50), () => [A], { cloudOk: up });
  assert.deepEqual(calls(steps), ["12:02:00 fail", "12:02:20 fail", "12:04:00 fail", "12:12:00 fail", "12:32:00 ok"]);
  assert.deepEqual(stores(steps), ["12:32 ×1"]);
  assert.deepEqual(messages(steps), ["12:32 erste (1)"]);
});

test("Ein neues Fahrzeug wartet nicht auf den Abstand: sein erster Versuch geht sofort, als eigener Eintrag", () => {
  // A fällig 12:02, B ab 12:01 (fällig 12:03); die Cloud antwortet erst ab 12:05.
  const state = emptyTrackState();
  const steps = simulate(state, at(12), at(12, 15), (t) => (t >= at(12, 1) ? [A, B] : [A]), { cloudOk: (t) => t >= at(12, 5) });
  // 12:03:00: B ist fällig und geht vor dem Abstand von A (bis 12:03:50) hinaus, mit eigenem Eintrag.
  // Danach gilt der Abstand der am häufigsten gescheiterten Meldung (erste Nachricht, 3 Versuche:
  // 8 Minuten); die offenen Einträge kommen nacheinander, der älteste zuerst.
  assert.deepEqual(calls(steps), ["12:02:00 fail", "12:02:20 fail", "12:03:00 fail", "12:11:00 ok", "12:11:20 ok"]);
  assert.deepEqual(
    steps.filter((s) => s.cloud).map((s) => s.plan.store.map((v) => v.box.x.toFixed(2)).join("+")),
    ["0.54", "0.54", "0.69", "0.54", "0.69"],
  );
  assert.deepEqual(stores(steps), ["12:11 ×1", "12:11 ×1"]);
  assert.deepEqual(state.standing.map((v) => [v.stored, v.storeTries]), [[true, 2], [true, 1]]);
  assert.deepEqual(state.standing.map((v) => v.storeKey), [`${at(12)}-0`, `${at(12, 1)}-0`]);
  assert.equal(state.retryAt, 0);

  // Nachts (nur Historie, keine Nachricht): der Abstand nach den Versuchen der Einträge.
  const night = emptyTrackState();
  const nightSteps = simulate(night, at(23), at(23, 15), (t) => (t >= at(23, 1) ? [A, B] : [A]), { cloudOk: (t) => t >= at(23, 5) });
  assert.deepEqual(calls(nightSteps), ["23:02:00 fail", "23:02:20 fail", "23:03:00 fail", "23:04:40 fail", "23:12:40 ok", "23:13:00 ok"]);
  assert.ok(nightSteps.every((s) => s.plan.notify === null));
});

test("Schlüssel der Meldung: gleich bei jedem Versuch und nach einem Neustart, je Nachricht verschieden", () => {
  const state = emptyTrackState();
  const keys: Array<{ storeKey: string | null; notifyKey: string | null }> = [];
  for (let t = at(12); t <= at(12, 3); t += STEP) {
    track(state, [A], t);
    const plan = planReport(state, t, cfgAt(t));
    applyPlan(state, plan, t);
    if (needsCloud(plan)) {
      keys.push(reportKeys(state, plan));
      applyDelivery(state, plan, false, t);
    }
  }
  // Erster Versuch 12:02:00, zweiter 12:02:20: derselbe Schlüssel.
  assert.equal(keys.length, 2);
  assert.deepEqual(keys[0], { storeKey: `${at(12)}-0`, notifyKey: `${at(12, 2)}-f` });
  assert.deepEqual(keys[1], keys[0]);
  // Nach einem Neustart (Zustand aus der Datei) ebenfalls.
  const loaded = parseTrackStates(serializeTrackStates(new Map([[9, state]]), at(12, 3)), at(12, 4)).get(9)!;
  track(loaded, [A], at(12, 4));
  const plan = planReport(loaded, at(12, 4), cfgAt(at(12, 4)));
  assert.deepEqual(reportKeys(loaded, plan), keys[0]);
  // Erinnerung: eigener Schlüssel, keine Sichtung.
  const ep = { startedAt: at(12, 2), firstAt: at(12, 2), reminders: 0, tries: 0 };
  const reminder = { ...plan, notify: { kind: "reminder" as const, n: 2 }, store: [] };
  assert.deepEqual(reportKeys({ ...emptyTrackState(), episode: ep }, reminder), { storeKey: null, notifyKey: `${at(12, 2)}-r2` });
});

test("Antwort der Cloud geht dreimal verloren (Zeitüberschreitung nach dem Push): eine Sichtung, eine Nachricht", () => {
  // Nachbau der Cloud: legt je Schlüssel einmal an und schickt je Schlüssel einmal; die ersten drei Antworten gehen verloren.
  const sightings = new Set<string>();
  const sent = new Set<string>();
  let lost = 0;
  const state = emptyTrackState();
  for (let t = at(12); t <= at(12, 50); t += STEP) {
    track(state, [A], t);
    const plan = planReport(state, t, cfgAt(t));
    applyPlan(state, plan, t);
    if (!needsCloud(plan)) continue;
    const { storeKey, notifyKey } = reportKeys(state, plan);
    if (storeKey) sightings.add(storeKey);
    if (notifyKey) sent.add(notifyKey);
    applyDelivery(state, plan, ++lost > 3, t);
  }
  assert.equal(sightings.size, 1);
  // Zugestellt erst um 12:12 (vierter Versuch); die Erinnerung zählt ab dort (12:42).
  assert.deepEqual([...sent], [`${at(12, 2)}-f`, `${at(12, 2)}-r1`]);
  assert.equal(state.episode!.firstAt, at(12, 12));
});

test("Cloud bleibt aus: nach 5 Versuchen aufgegeben, die Prüfung läuft weiter", () => {
  const state = emptyTrackState();
  const steps = simulate(state, at(12), at(12, 40), () => [A], { cloudOk: () => false });
  assert.equal(steps.filter((s) => s.cloud).length, MAX_REPORT_TRIES);
  assert.deepEqual(calls(steps), ["12:02:00 fail", "12:02:20 fail", "12:04:00 fail", "12:12:00 fail", "12:32:00 fail"]);
  assert.equal(state.standing[0].stored, true);
  assert.equal(state.episode!.firstAt, at(12, 32));
  assert.equal(state.retryAt, 0);
  // Danach nur noch die Erinnerung nach 30 Minuten.
  const later = simulate(state, at(12, 40), at(13, 10), () => [A], { cloudOk: () => true });
  assert.deepEqual(messages(later), ["13:02 Erinnerung 1 (1)"]);
});

test("Drei unbewegte Fahrzeuge über 4,5 Stunden: höchstens 6 Ansagen und 4 Nachrichten", () => {
  const steps = simulate(emptyTrackState(), at(17, 55), at(22, 25), () => [A, B, C]);
  const announcements = steps.filter((s) => s.plan.speak).length;
  const perVehicle = steps.reduce((n, s) => n + s.plan.speakFor.length, 0);
  assert.ok(announcements <= 6, `${announcements} Ansagen`);
  assert.equal(perVehicle, 6);
  assert.deepEqual(messages(steps), ["17:57 erste (3)", "18:27 Erinnerung 1 (3)", "18:57 Erinnerung 2 (3)", "19:57 Erinnerung 3 (3)"]);
  assert.deepEqual(stores(steps), ["17:57 ×3"]);
});

test("planReport ändert nichts; erst applyPlan setzt Zeitpunkt der Meldung, Ansagen und Episode", () => {
  const state = emptyTrackState();
  track(state, [A], at(12));
  track(state, [A], at(12, 2));
  const snapshot = JSON.stringify(state);
  const plan = planReport(state, at(12, 2), cfgAt(at(12, 2)));
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(plan.due.length, 1);
  assert.equal(plan.opensEpisode, true);
  applyPlan(state, plan, at(12, 2));
  assert.equal(state.standing[0].reportedAt, at(12, 2));
  assert.equal(state.standing[0].speaks, 1);
  assert.equal(state.lastSpeakAt, at(12, 2));
  assert.deepEqual(state.episode, { startedAt: at(12, 2), firstAt: 0, reminders: 0, tries: 0 });
});

test("Nur ein fälliges Fahrzeug beginnt eine Episode: ein gemeldetes ohne laufende oder bei wartender bekommt keine erste Nachricht", () => {
  const state = emptyTrackState();
  simulate(state, at(12), at(12, 5), () => [A]);
  assert.equal(state.standing[0].reportedAt, at(12, 2));
  const waiting: Episode = { startedAt: at(12, 2), firstAt: at(12, 2), reminders: 0, tries: 0, vacated: true };
  for (const [episode, t] of [
    [null, at(12, 5) + STEP],
    [waiting, at(12, 5) + 2 * STEP],
  ] as const) {
    track(state, [A], t);
    state.episode = episode;
    const plan = planReport(state, t, cfgAt(t));
    assert.deepEqual([plan.due, plan.opensEpisode, plan.notify, plan.inZone], [[], false, null, 1]);
  }
  // Wird daneben B fällig (zuerst gesehen 12:06), beginnt es eine Episode; A zählt mit.
  state.episode = null;
  simulate(state, at(12, 6), at(12, 8) - STEP, () => [A, B]);
  track(state, [A, B], at(12, 8));
  const plan = planReport(state, at(12, 8), cfgAt(at(12, 8)));
  assert.deepEqual([plan.due.length, plan.opensEpisode, plan.notify, plan.inZone], [1, true, { kind: "first" }, 2]);
});

test("Fahrzeug mit Aussetzer im fälligen Durchlauf: Meldung beim nächsten Treffer", () => {
  const state = emptyTrackState();
  const steps = simulate(state, at(12), at(12, 5), (t) => (t === at(12, 2) ? [] : [A]));
  // 12:02:00 fehlt die Box, 12:02:20 wird gemeldet.
  assert.ok(MAX_MISSES >= 1);
  const stored = steps.filter((s) => s.plan.store.length > 0).map((s) => s.at);
  assert.deepEqual(stored, [at(12, 2) + STEP]);
});

/*
 * Abläufe aus der Nachprüfung, je einer als Test.
 */

/** Anderes Fahrzeug, fast dieselbe Box wie A (Überdeckung über SAME_VEHICLE_IOU). */
const A2 = car(0.605, { w: 0.115 });

/**
 * Durchläufe mit einem Nachbau der Cloud: Sie legt je Schlüssel des Eintrags
 * eine Sichtung an und schickt je Schlüssel der Nachricht eine Nachricht; ein
 * wiederholter Schlüssel ändert nichts. `answer(t)` = false: Die Cloud hat
 * alles erledigt, die Antwort kommt beim Hub aber nicht an.
 */
function withCloud(state: TrackState, from: number, to: number, boxesAt: (t: number) => NoParkBox[], answer: (t: number) => boolean = () => true) {
  const sightings = new Map<string, string[]>();
  const sent: string[] = [];
  const tries: string[] = [];
  for (let t = from; t <= to; t += STEP) {
    track(state, boxesAt(t), t);
    const plan = planReport(state, t, cfgAt(t));
    applyPlan(state, plan, t);
    if (!needsCloud(plan)) continue;
    const { storeKey, notifyKey } = reportKeys(state, plan);
    if (storeKey && !sightings.has(storeKey)) sightings.set(storeKey, plan.store.map((v) => v.id));
    if (notifyKey && !sent.includes(notifyKey)) sent.push(notifyKey);
    tries.push(`${stamp(t)} ${storeKey ?? "-"}`);
    applyDelivery(state, plan, answer(t), t);
  }
  return { sightings, sent, tries };
}

/** A steht 12:00–14:10 (alle Nachrichten der Episode), dann 10 Minuten leer im Ruhetakt; danach steht `b` 60 Minuten. */
function aThenB(b: NoParkBox) {
  const state = emptyTrackState();
  const a = simulate(state, at(12), at(14, 10) - STEP, () => [A]);
  const idA = state.standing[0].id;
  assert.deepEqual(messages(a), ["12:02 erste (1)", "12:32 Erinnerung 1 (1)", "13:02 Erinnerung 2 (1)", "14:02 Erinnerung 3 (1)"]);
  // Leere Fläche im Ruhetakt (60 s): nach 3 Minuten ist A weggefahren; die Episode wartet nur noch auf A.
  const empty = simulate(state, at(14, 10), at(14, 19), () => [], { step: MIN });
  assert.ok(empty.every((s) => !s.plan.speak && !needsCloud(s.plan)));
  assert.equal(state.episode?.vacated, true);
  return { state, idA, b: simulate(state, at(14, 20), at(15, 20) - STEP, () => [b]) };
}

test("Nachprüfung: A steht 130 Minuten, 10 Minuten leer, B steht 60 Minuten halb an derselben Stelle (Überdeckung 0,5) – B wird eigens gemeldet", () => {
  const { state, idA, b } = aThenB(A_HALF);
  assert.deepEqual(speaks(b), ["14:22", "14:32"]);
  assert.deepEqual(messages(b), ["14:22 erste (1)", "14:52 Erinnerung 1 (1)"]);
  assert.deepEqual(stores(b), ["14:22 ×1"]);
  const [v] = state.standing;
  assert.deepEqual([v.firstSeenAt, v.reportedAt, v.speaks, v.stored], [at(14, 20), at(14, 22), 2, true]);
  assert.notEqual(v.id, idA);
  assert.equal(v.storeKey, v.id);
  assert.equal(state.episode!.startedAt, at(14, 22));
});

test("Nachprüfung: A steht 130 Minuten, 10 Minuten leer, B steht fast an derselben Stelle (Überdeckung 0,85) – gilt bewusst als A, nichts Neues", () => {
  const { state, idA, b } = aThenB(A_NEAR);
  assert.deepEqual([speaks(b), messages(b), stores(b)], [[], [], []]);
  const [v] = state.standing;
  assert.deepEqual([state.standing.length, v.id, v.firstSeenAt, v.speaks], [1, idA, at(12), 2]);
  assert.equal(state.episode!.startedAt, at(12, 2));
});

for (const [label, b] of [["Überdeckung 0,5", A_HALF], ["Überdeckung 0,96", A2]] as const) {
  test(`Nachprüfung: A hält 80 s, 5 Minuten leer, B hält an derselben Stelle (${label}) – B zählt seine eigene Standzeit`, () => {
    // A 12:00:00–12:01:20 (nicht gemeldet), leer bis 12:06:40, B ab 12:06:40 für `bFor`.
    const boxes = (bFor: number) => (t: number) =>
      t < at(12) + 5 * STEP ? [A] : t < at(12) + 20 * STEP ? [] : t < at(12) + 20 * STEP + bFor ? [b] : [];
    // B hält 40 s: A und B zusammen 2 Minuten, aber keine Meldung.
    const short = simulate(emptyTrackState(), at(12), at(12, 20), boxes(2 * STEP));
    assert.deepEqual([speaks(short), stores(short), messages(short)], [[], [], []]);
    // Bleibt B 3 Minuten: gemeldet 2 Minuten nach seiner ersten Sichtung.
    const state = emptyTrackState();
    const long = simulate(state, at(12), at(12, 20), boxes(3 * MIN));
    assert.deepEqual([speaks(long), stores(long), messages(long)], [["12:08"], ["12:08 ×1"], ["12:08 erste (1)"]]);
    assert.equal(long.find((s) => s.plan.store.length > 0)!.at, at(12) + 20 * STEP + 2 * MIN);
  });
}

test("Langer Takt (HUB_NOPARK_INTERVAL=330): leere Prüfungen zählen, die Episode endet, ein späteres Fahrzeug bekommt seine erste Nachricht", () => {
  const step = 330 * SEC;
  const state = emptyTrackState();
  // A steht 12:00–12:30, B ab 16:00 an anderer Stelle.
  const steps = simulate(state, at(12), at(17), (t) => (t < at(12, 30) ? [A] : t >= at(16) ? [B] : []), {
    step,
    gapLimitMs: observedGapLimitMs(step),
  });
  const firsts = messages(steps).filter((m) => m.includes("erste"));
  assert.equal(firsts.length, 2, messages(steps).join(" | "));
  assert.equal(stores(steps).length, 2);
});

test("Langer Takt (HUB_NOPARK_INTERVAL=330 und 480): ein, zwei Fehlerkennungen machen aus einem stehenden Fahrzeug kein neues", () => {
  for (const [sec, misses] of [
    [330, [5, 6]],
    [480, [5]],
  ] as const) {
    const step = sec * SEC;
    const state = emptyTrackState();
    // A steht 12:00–14:00; der Tracker übersieht es in den Prüfungen `misses` (gezählt ab 0).
    const missed = (t: number) => (misses as readonly number[]).includes((t - at(12)) / step);
    const steps = simulate(state, at(12), at(14) - 1, (t) => (missed(t) ? [] : [A]), { step, gapLimitMs: observedGapLimitMs(step) });
    const label = `Takt ${sec} s: ${messages(steps).join(" | ")}`;
    assert.equal(stores(steps).length, 1, label);
    assert.equal(speaks(steps).length, 2, label);
    assert.equal(messages(steps).filter((m) => m.includes("erste")).length, 1, label);
    assert.deepEqual([state.standing.length, state.lost.length, state.standing[0].firstSeenAt], [1, 0, at(12)], label);
  }
});

test("Nachprüfung: nachts im Takt 120 s fehlt ein stehendes Fahrzeug in zwei Prüfungen – keine zweite Meldung", () => {
  // Takt 120 s (leere Fläche nachts, oder HUB_NOPARK_INTERVAL=120). A ab 23:00, gemeldet 23:02 (nur Historie).
  const night = { step: 2 * MIN };
  const state = emptyTrackState();
  const steps = simulate(state, at(23), at(7, 10, 1), (t) => (t === at(23, 30) || t === at(23, 32) ? [] : [A]), night);
  assert.deepEqual(stores(steps), ["23:02 ×1"]);
  assert.deepEqual(speaks(steps), []);
  assert.deepEqual(messages(steps), ["07:00 erste (1)"]);
  assert.deepEqual([state.standing.length, state.standing[0].firstSeenAt], [1, at(23)]);
  // Um 7 Uhr ohne neuen Eintrag: Die Cloud schickt den gespeicherten Ausschnitt von 23:02 an Telegram.
  const morning = steps.find((s) => s.plan.notify?.kind === "first")!;
  assert.equal(evidenceKeyFor(state, morning.plan), `${at(23)}-0`);
  // Drei leere Prüfungen (6 Minuten beobachtet leer): an derselben Stelle (SAME_SPOT_IOU) noch dasselbe …
  const same = simulate(emptyTrackState(), at(23), at(23, 50), (t) => (t >= at(23, 30) && t <= at(23, 34) ? [] : [A]), night);
  assert.deepEqual(stores(same), ["23:02 ×1"]);
  // … mit Überdeckung 0,5 ein neues Fahrzeug.
  const three = simulate(emptyTrackState(), at(23), at(23, 50), (t) => (t < at(23, 30) ? [A] : t > at(23, 34) ? [A_HALF] : []), night);
  assert.deepEqual(stores(three), ["23:02 ×1", "23:38 ×1"]);
});

test("Nachprüfung: A und B im selben Durchlauf zuerst gesehen, B fehlt beim Fälligwerden – je ein Eintrag mit eigenem Schlüssel", () => {
  const idA = `${at(12)}-0`;
  const idB = `${at(12)}-1`;
  const state = emptyTrackState();
  const c = withCloud(state, at(12), at(12, 5), (t) => (t === at(12, 2) ? [A] : [A, B]));
  assert.deepEqual(state.standing.map((v) => v.id), [idA, idB]);
  assert.deepEqual(c.tries, [`12:02:00 ${idA}`, `12:02:20 ${idB}`]);
  assert.deepEqual([...c.sightings], [[idA, [idA]], [idB, [idB]]]);
  // Die Antwort auf A geht verloren: B schließt sich dem offenen Versuch nicht an, A behält seinen Schlüssel.
  const lost = withCloud(emptyTrackState(), at(12), at(12, 5), (t) => (t === at(12, 2) ? [A] : [A, B]), (t) => t !== at(12, 2));
  assert.deepEqual(lost.tries, [`12:02:00 ${idA}`, `12:02:20 ${idB}`, `12:02:40 ${idA}`]);
  assert.deepEqual([...lost.sightings], [[idA, [idA]], [idB, [idB]]]);
  assert.deepEqual(lost.sent, [`${at(12, 2)}-f`]);
});

test("Nachprüfung: Antwort auf A geht verloren, im nächsten Durchlauf wird B fällig – eine Sichtung je Fahrzeug", () => {
  const idA = `${at(12)}-0`;
  const idB = `${at(12) + STEP}-0`;
  const state = emptyTrackState();
  const c = withCloud(state, at(12), at(12, 5), (t) => (t >= at(12) + STEP ? [A, B] : [A]), (t) => t !== at(12, 2));
  assert.deepEqual(c.tries, [`12:02:00 ${idA}`, `12:02:20 ${idB}`, `12:02:40 ${idA}`]);
  assert.deepEqual([...c.sightings], [[idA, [idA]], [idB, [idB]]]);
  assert.deepEqual(c.sent, [`${at(12, 2)}-f`]);
  assert.ok(state.standing.every((v) => v.stored && v.storeKey === v.id));
});

test("Nachprüfung: Neustart nach 16 Minuten, das Fahrzeug steht weiter – keine zweite Erstmeldung, kein zweiter Eintrag", () => {
  const before = emptyTrackState();
  const first = simulate(before, at(12), at(12, 5), () => [A]);
  assert.deepEqual([messages(first), stores(first), speaks(first)], [["12:02 erste (1)"], ["12:02 ×1"], ["12:02"]]);
  const file = serializeTrackStates(new Map([[9, before]]), at(12, 5));
  const loaded = parseTrackStates(file, at(12, 21)).get(9)!;
  assert.deepEqual([loaded.standing.length, loaded.standing[0].id, loaded.episode?.firstAt], [1, `${at(12)}-0`, at(12, 2)]);
  const after = simulate(loaded, at(12, 21), at(13, 10), () => [A]);
  assert.deepEqual(stores(after), []);
  // Die zweite Ansage (fällig 12:12, der Hub war aus) kommt nach; mehr nicht.
  assert.deepEqual(speaks(after), ["12:21"]);
  assert.deepEqual(messages(after), ["12:32 Erinnerung 1 (1)", "13:02 Erinnerung 2 (1)"]);
  assert.equal(loaded.standing[0].firstSeenAt, at(12));
});

test("Nachprüfung: Absturz nach applyPlan, vor der Antwort der Cloud – nach dem Neustart dieselben Schlüssel, keine zweite Ansage", () => {
  const state = emptyTrackState();
  simulate(state, at(12), at(12, 2) - STEP, () => [A]);
  // 12:02 fällig; wie noparking.ts: Plan anwenden, Zustand sichern, dann melden – hier stürzt der Hub ab.
  track(state, [A], at(12, 2));
  const plan = planReport(state, at(12, 2), cfgAt(at(12, 2)));
  applyPlan(state, plan, at(12, 2));
  assert.deepEqual([plan.speak, plan.notify, plan.store.length], [true, { kind: "first" }, 1]);
  const keys = reportKeys(state, plan);
  const file = serializeTrackStates(new Map([[9, state]]), at(12, 2));
  const loaded = parseTrackStates(file, at(12, 3)).get(9)!;
  const after = simulate(loaded, at(12, 3), at(12, 10), () => [A]);
  const retry = after.find((s) => needsCloud(s.plan))!;
  assert.equal(retry.at, at(12, 3));
  assert.deepEqual(reportKeys(loaded, retry.plan), keys);
  assert.deepEqual(speaks(after), []);
  assert.deepEqual([stores(after), messages(after)], [["12:03 ×1"], ["12:03 erste (1)"]]);
});

test("Nachprüfung: Cloud weg, das Fahrzeug fährt vor der Wiederholung weg – sie trägt das Bild des ersten Versuchs", () => {
  const state = emptyTrackState();
  const images = new AttemptImages<string>();
  const sent: string[] = [];
  for (let t = at(12); t <= at(12, 15); t += STEP) {
    const boxes = t < at(12, 5) ? [A] : [];
    track(state, boxes, t);
    const plan = planReport(state, t, cfgAt(t));
    applyPlan(state, plan, t);
    if (!needsCloud(plan)) continue;
    // Wie noparking.ts: Bilder je Meldung, beim ersten Versuch aufgenommen.
    const key = AttemptImages.key(9, reportKeys(state, plan));
    const { value } = images.get(key, t, () => `Bild ${stamp(t)} ${boxes.length > 0 ? "mit Fahrzeug" : "leer"}`);
    const ok = t >= at(12, 10);
    sent.push(`${stamp(t)}: ${value}${ok ? " (ok)" : ""}`);
    applyDelivery(state, plan, ok, t);
    if (ok) images.done(key, t);
  }
  assert.deepEqual(sent, [
    "12:02:00: Bild 12:02:00 mit Fahrzeug",
    "12:02:20: Bild 12:02:00 mit Fahrzeug",
    "12:04:00: Bild 12:02:00 mit Fahrzeug",
    "12:12:00: Bild 12:02:00 mit Fahrzeug (ok)",
  ]);
  assert.equal(images.size, 0);
});

test("Bilder des ersten Versuchs: je Meldung gemerkt, erledigte und alte vergessen", () => {
  const images = new AttemptImages<string>(60 * MIN);
  const k = AttemptImages.key(9, { storeKey: "s1", notifyKey: "n1" });
  assert.equal(k, "9:s:s1");
  assert.equal(AttemptImages.key(9, { storeKey: null, notifyKey: "n1" }), "9:n:n1");
  assert.equal(AttemptImages.key(9, { storeKey: null, notifyKey: null }), null);
  let made = 0;
  const make = () => `Bild ${++made}`;
  assert.deepEqual(images.get(k, at(12), make), { value: "Bild 1", repeated: false });
  assert.deepEqual(images.get(k, at(12, 1), make), { value: "Bild 1", repeated: true });
  // Ohne Schlüssel wird nichts gemerkt.
  assert.deepEqual(images.get(null, at(12), make), { value: "Bild 2", repeated: false });
  assert.equal(images.size, 1);
  images.done(k, at(12, 2));
  assert.equal(images.size, 0);
  images.get("9:s:s2", at(12), make);
  images.done(null, at(12) + 60 * MIN);
  assert.equal(images.size, 1);
  images.done(null, at(12) + 60 * MIN + 1);
  assert.equal(images.size, 0);
});

test("Bilder des ersten Versuchs: älter als das Höchstalter werden auch ohne done verworfen", () => {
  const images = new AttemptImages<string>();
  const k = AttemptImages.key(7, { storeKey: null, notifyKey: "100-f" });
  images.get(k, at(21, 59), () => "Bild 21:59");
  assert.deepEqual(images.get(k, at(21, 59) + 2 * 60 * MIN, () => "neu"), { value: "Bild 21:59", repeated: true });
  // 9 Stunden später, dazwischen kein done: ein neues Bild, kein altes.
  assert.deepEqual(images.get(k, at(7, 0, 1), () => "Bild 07:00"), { value: "Bild 07:00", repeated: false });
  assert.deepEqual(images.get(k, at(7, 0, 1) + MIN, () => "x"), { value: "Bild 07:00", repeated: true });
  assert.equal(images.size, 1);
});

test("Ausschnitt zur ersten Nachricht: gespeicherter Eintrag nur, wenn der Plan selbst keinen trägt", () => {
  const state = emptyTrackState();
  const steps = simulate(state, at(12), at(12, 5), () => [A]);
  const first = steps.find((s) => s.plan.notify?.kind === "first")!;
  // Mit eigenem Eintrag reicht der Hub den Ausschnitt nach.
  assert.equal(evidenceKeyFor(state, first.plan), null);
  const without = { ...first.plan, store: [] };
  assert.equal(evidenceKeyFor(state, without), `${at(12)}-0`);
  assert.equal(evidenceKeyFor(state, { ...without, notify: { kind: "reminder", n: 1 } }), null);
  assert.equal(evidenceKeyFor(emptyTrackState(), without), null);
  // Kein zugestellter Eintrag: nichts.
  state.standing[0].stored = false;
  assert.equal(evidenceKeyFor(state, without), null);
});
