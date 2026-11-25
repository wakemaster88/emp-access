import { test } from "node:test";
import assert from "node:assert/strict";
import { inQuietHours } from "./quiet.js";
import {
  COOLDOWN_MS,
  EMPTY_COOLDOWN_MS,
  HOUR_MS,
  RETRY_MAX_AGE_MS,
  TALLY_GRACE_MS,
  VEHICLE_BACKLOG_MAX,
  appendBacklog,
  awaitsResult,
  cooldownFor,
  dueTallies,
  finishInspection,
  isEarly,
  isTriggerEvent,
  lockMs,
  newQueue,
  newTally,
  planTick,
  retryVerdict,
  shouldInspect,
  tallyDue,
  tallyLine,
  tallyOpen,
  triggerVerdict,
  type InspectMark,
  type InspectOutcome,
  type RetryContext,
  type SentinelContext,
  type SentinelEvent,
  type SentinelQueue,
  type SentinelTally,
  type StartedInspection,
  type TickInput,
} from "./sentinel-rules.js";

const SEC = 1000;
/** Volle Stunde, 23:00 Ortszeit. */
const T0 = Date.UTC(2026, 0, 15, 22, 0);
const OUTCOMES: InspectOutcome[] = ["alarm", "kein_alarm", "unauffaellig", "tracker_leer", "nahaufnahme_leer", "fehler"];
const EMPTY: InspectOutcome[] = ["unauffaellig", "tracker_leer", "nahaufnahme_leer", "fehler"];

const person: SentinelEvent = { kind: "camera", title: "PERSON erkannt", where: "Kamera 1" };
const base: SentinelContext = {
  closed: true,
  hour: 23,
  nightWindow: "22-6",
  always: false,
  lastInspectAt: undefined,
  now: T0,
  cooldownMs: COOLDOWN_MS,
  inspectionsLastHour: 0,
  maxPerHour: 30,
};

/* ------------------------------------------------------------ Sperrzeit */

test("Sperrzeit: 3 Minuten nach Alarm und „kein Alarm“, zu jeder Stunde", () => {
  assert.equal(COOLDOWN_MS, 180 * SEC);
  for (const hour of [0, 3, 6, 12, 21, 22, 23]) {
    assert.equal(cooldownFor("alarm", hour, "22-6"), COOLDOWN_MS, `alarm ${hour}`);
    assert.equal(cooldownFor("kein_alarm", hour, "22-6"), COOLDOWN_MS, `kein_alarm ${hour}`);
  }
});

test("Sperrzeit: 45 Sekunden nach leerem Ergebnis oder Fehler, aber nur im Nachtfenster", () => {
  assert.equal(EMPTY_COOLDOWN_MS, 45 * SEC);
  for (const outcome of EMPTY) {
    for (const hour of [22, 23, 0, 3, 5]) assert.equal(cooldownFor(outcome, hour, "22-6"), EMPTY_COOLDOWN_MS, `${outcome} ${hour}`);
    for (const hour of [6, 9, 12, 18, 21]) assert.equal(cooldownFor(outcome, hour, "22-6"), COOLDOWN_MS, `${outcome} ${hour}`);
  }
  // Das Nachtfenster kommt aus HUB_AGENT_SENTINEL_NIGHT.
  assert.equal(cooldownFor("unauffaellig", 20, "20-7"), EMPTY_COOLDOWN_MS);
  assert.equal(cooldownFor("unauffaellig", 7, "20-7"), COOLDOWN_MS);
  // Ohne lesbare Stunde oder ohne gueltiges Fenster gibt es keine Nacht.
  assert.equal(cooldownFor("unauffaellig", NaN, "22-6"), COOLDOWN_MS);
  assert.equal(cooldownFor("fehler", 23, ""), COOLDOWN_MS);
  assert.equal(cooldownFor("tracker_leer", 23, "7-7"), COOLDOWN_MS);
});

test("Bewertung mit ergebnisabhaengiger Sperrzeit: 44 s zu frueh, 46 s reicht", () => {
  const after = (outcome: InspectOutcome, hour: number, seconds: number) =>
    shouldInspect(person, { ...base, hour, lastInspectAt: T0, now: T0 + seconds * SEC, cooldownMs: cooldownFor(outcome, hour, "22-6") });
  for (const outcome of EMPTY) {
    assert.equal(after(outcome, 23, 44), false, outcome);
    assert.equal(after(outcome, 23, 46), true, outcome);
    // Am Tag bleibt es bei 3 Minuten.
    assert.equal(after(outcome, 14, 46), false, outcome);
    assert.equal(after(outcome, 14, 179), false, outcome);
    assert.equal(after(outcome, 14, 181), true, outcome);
  }
  for (const outcome of ["alarm", "kein_alarm"] as const) {
    assert.equal(after(outcome, 23, 46), false, outcome);
    assert.equal(after(outcome, 23, 179), false, outcome);
    assert.equal(after(outcome, 23, 181), true, outcome);
  }
});

/* ------------------------------------------------------------ Ausloeser */

test("Ereignis einordnen: kein Ausloeser, Abstand, Limit, bewerten", () => {
  assert.equal(triggerVerdict(person, base), "bewerten");
  assert.equal(triggerVerdict({ ...person, title: "VEHICLE erkannt" }, base), "bewerten");
  // Kein Ausloeser: anderes Ereignis, Raum offen, ohne Betriebszeit am Tag.
  assert.equal(triggerVerdict({ ...person, title: "PERSON beendet" }, base), "kein_ausloeser");
  assert.equal(triggerVerdict({ ...person, title: "MOTION erkannt" }, base), "kein_ausloeser");
  assert.equal(triggerVerdict({ ...person, where: null }, base), "kein_ausloeser");
  assert.equal(triggerVerdict(person, { ...base, closed: false }), "kein_ausloeser");
  assert.equal(triggerVerdict(person, { ...base, closed: null, hour: 12 }), "kein_ausloeser");
  assert.equal(triggerVerdict(person, { ...base, closed: null, hour: 23 }), "bewerten");
  assert.equal(triggerVerdict(person, { ...base, closed: false, always: true }), "bewerten");
  // Im Betrieb zaehlt ein Ereignis auch dann nicht als Ausloeser, wenn die Sperrzeit noch laeuft.
  assert.equal(triggerVerdict(person, { ...base, closed: false, lastInspectAt: T0 - 10 * SEC }), "kein_ausloeser");
  // Uebergangen: Sperrzeit der Kamera, dann Stundenlimit.
  assert.equal(triggerVerdict(person, { ...base, lastInspectAt: T0 - 10 * SEC }), "abstand");
  assert.equal(triggerVerdict(person, { ...base, lastInspectAt: T0 - 181 * SEC }), "bewerten");
  assert.equal(triggerVerdict(person, { ...base, inspectionsLastHour: 30 }), "limit");
  assert.equal(triggerVerdict(person, { ...base, inspectionsLastHour: 30, lastInspectAt: T0 - 10 * SEC }), "abstand");
});

test("Bewertet wird genau dann, wenn alle Bedingungen zugleich erfuellt sind", () => {
  const expected = (ev: SentinelEvent, ctx: SentinelContext): boolean => {
    if (!isTriggerEvent(ev)) return false;
    if (ctx.lastInspectAt !== undefined && ctx.now - ctx.lastInspectAt < ctx.cooldownMs) return false;
    if (ctx.inspectionsLastHour >= ctx.maxPerHour) return false;
    if (ctx.always) return true;
    if (ctx.closed === true) return true;
    if (ctx.closed === false) return false;
    return inQuietHours(ctx.nightWindow, ctx.hour);
  };
  let n = 0;
  for (const title of ["PERSON erkannt", "VEHICLE erkannt", "PERSON beendet", "MOTION erkannt"]) {
    for (const closed of [true, false, null]) {
      for (const hour of [...Array.from({ length: 24 }, (_, h) => h), NaN]) {
        for (const always of [true, false]) {
          for (const lastInspectAt of [undefined, T0 - 10 * SEC, T0 - 200 * SEC]) {
            for (const inspectionsLastHour of [0, 29, 30]) {
              const ev = { ...person, title };
              const ctx = { ...base, closed, hour, always, lastInspectAt, inspectionsLastHour };
              assert.equal(shouldInspect(ev, ctx), expected(ev, ctx), JSON.stringify({ title, closed, hour, always, lastInspectAt, inspectionsLastHour }));
              assert.equal(triggerVerdict(ev, ctx) === "bewerten", expected(ev, ctx));
              n++;
            }
          }
        }
      }
    }
  }
  assert.equal(n, 4 * 3 * 25 * 2 * 3 * 3);
});

test("Zurueckgestellter Ausloeser: bewerten, warten, verfallen", () => {
  const ctx: RetryContext = { seenAt: T0, now: T0 + 3 * SEC, busy: 1, maxBusy: 2, lastInspectAt: undefined, cooldownMs: COOLDOWN_MS, inspectionsLastHour: 0, maxPerHour: 30 };
  assert.equal(RETRY_MAX_AGE_MS, 30 * SEC);
  assert.equal(retryVerdict(ctx), "bewerten");
  assert.equal(retryVerdict({ ...ctx, busy: 2 }), "warten");
  assert.equal(retryVerdict({ ...ctx, busy: 2, now: T0 + 29_999 }), "warten");
  // Nach 30 Sekunden verfaellt er, auch wenn jetzt ein Platz frei ist.
  assert.equal(retryVerdict({ ...ctx, busy: 2, now: T0 + 30 * SEC }), "belegt");
  assert.equal(retryVerdict({ ...ctx, busy: 0, now: T0 + 30 * SEC }), "belegt");
  assert.equal(retryVerdict({ ...ctx, busy: 0, now: T0 + 29_999 }), "bewerten");
  // Die Kamera wurde inzwischen bewertet: keine zweite Bewertung.
  assert.equal(retryVerdict({ ...ctx, lastInspectAt: T0 + SEC }), "abstand");
  assert.equal(retryVerdict({ ...ctx, lastInspectAt: T0 - 181 * SEC }), "bewerten");
  // Stundenlimit erreicht.
  assert.equal(retryVerdict({ ...ctx, inspectionsLastHour: 30 }), "limit");
  // Das Ergebnis eines vorgezogenen Blicks auf die Kamera steht aus: warten, hoechstens 30 Sekunden.
  assert.equal(retryVerdict({ ...ctx, lastInspectAt: T0 - 10 * SEC, awaitsResult: true }), "warten");
  assert.equal(retryVerdict({ ...ctx, lastInspectAt: T0 - 10 * SEC, awaitsResult: true, busy: 0 }), "warten");
  assert.equal(retryVerdict({ ...ctx, lastInspectAt: T0 - 10 * SEC, awaitsResult: true, now: T0 + 30 * SEC }), "abstand");
  assert.equal(retryVerdict({ ...ctx, lastInspectAt: T0 - 10 * SEC, awaitsResult: false }), "abstand");
});

test("Zurueckgestellter Ausloeser: Die Wartefrist auf einen Platz zaehlt ab dem letzten Takt, in dem ein vorgezogener Blick ihn hielt", () => {
  const ctx: RetryContext = { seenAt: T0, now: T0 + 60 * SEC, busy: 2, maxBusy: 2, lastInspectAt: undefined, cooldownMs: COOLDOWN_MS, inspectionsLastHour: 0, maxPerHour: 30 };
  // Ohne vorgezogenen Blick ist er nach 60 Sekunden verfallen.
  assert.equal(retryVerdict(ctx), "belegt");
  // Ein vorgezogener Blick hielt bis eben einen Platz: Er wartet weiter und ist dran, sobald ein Platz frei ist.
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 60 * SEC }), "warten");
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 57 * SEC }), "warten");
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 57 * SEC, busy: 1 }), "bewerten");
  // Seitdem halten nur Bewertungen des langen Takts die Plaetze: noch 30 Sekunden, dann verfaellt er.
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 30 * SEC + 1 }), "warten");
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 30 * SEC }), "belegt");
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 30 * SEC, busy: 0 }), "belegt");
  // Sperrzeit und Stundenlimit gelten wie fuer jeden wartenden Ausloeser.
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 57 * SEC, lastInspectAt: T0 + 40 * SEC }), "abstand");
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 57 * SEC, inspectionsLastHour: 30 }), "limit");
  // Wer das Ergebnis des vorgezogenen Blicks auf seine eigene Kamera abwartet, wartet weiter hoechstens 30 Sekunden.
  assert.equal(retryVerdict({ ...ctx, heldAt: T0 + 57 * SEC, lastInspectAt: T0 - 10 * SEC, awaitsResult: true }), "abstand");
});

/* ---------------------------------------------------------------- Bilanz */

const tally = (o: Partial<SentinelTally> = {}): SentinelTally => ({ ...newTally(T0), ...o });

test("Bilanz-Zeile: Ausloeser, bewertet, uebergangen nach Grund, Ergebnisse", () => {
  const t = tally({
    triggers: 23,
    inspected: 14,
    skipped: { abstand: 8, limit: 0, belegt: 1 },
    outcomes: { alarm: 6, kein_alarm: 0, unauffaellig: 5, tracker_leer: 3, nahaufnahme_leer: 0, fehler: 0 },
  });
  assert.equal(tallyOpen(t), 0);
  assert.equal(tallyLine(t, 23), "Wächter 23–0 Uhr: 23 Auslöser, 14 bewertet, 9 übergangen (Abstand 8, Limit 0, belegt 1); 6 Alarm, 5 unauffällig, 3 Tracker leer");
  // Alle Ergebnisse, feste Reihenfolge.
  const all = tally({ triggers: 6, inspected: 6, outcomes: { alarm: 1, kein_alarm: 1, unauffaellig: 1, tracker_leer: 1, nahaufnahme_leer: 1, fehler: 1 } });
  assert.equal(
    tallyLine(all, 3),
    "Wächter 3–4 Uhr: 6 Auslöser, 6 bewertet, 0 übergangen; 1 Alarm, 1 kein Alarm, 1 unauffällig, 1 Tracker leer, 1 Nahaufnahme leer, 1 Fehler",
  );
  // Nur uebergangen.
  assert.equal(tallyLine(tally({ triggers: 2, skipped: { abstand: 0, limit: 2, belegt: 0 } }), 12), "Wächter 12–13 Uhr: 2 Auslöser, 0 bewertet, 2 übergangen (Abstand 0, Limit 2, belegt 0)");
  // Bewertungen, die erst die kurze Sperrzeit moeglich gemacht hat, stehen dabei.
  const early = tally({ triggers: 5, inspected: 4, early: 2, skipped: { abstand: 1, limit: 0, belegt: 0 }, outcomes: { ...newTally(T0).outcomes, alarm: 1, unauffaellig: 3 } });
  assert.equal(
    tallyLine(early, 2),
    "Wächter 2–3 Uhr: 5 Auslöser, 4 bewertet (davon 2 nach kurzer Sperrzeit), 1 übergangen (Abstand 1, Limit 0, belegt 0); 1 Alarm, 3 unauffällig",
  );
  // Ohne lesbare Stunde.
  assert.equal(tallyLine(tally({ triggers: 1, inspected: 1, outcomes: { ...newTally(T0).outcomes, alarm: 1 } }), NaN), "Wächter 1 h: 1 Auslöser, 1 bewertet, 0 übergangen; 1 Alarm");
});

test("Bilanz: keine Zeile ohne Ausloeser, offene Ausloeser stehen dabei", () => {
  assert.equal(tallyLine(tally(), 23), null);
  const open = tally({ triggers: 3, inspected: 2, outcomes: { ...newTally(T0).outcomes, alarm: 1 } });
  assert.equal(tallyOpen(open), 2);
  assert.equal(tallyLine(open, 23), "Wächter 23–0 Uhr: 3 Auslöser, 2 bewertet, 0 übergangen; 1 Alarm, 2 noch offen");
});

test("Bilanz ist faellig, wenn die Stunde vorbei und alles erledigt ist, spaetestens 10 Minuten danach", () => {
  assert.equal(newTally(T0 + 59 * 60 * SEC + 59 * SEC).start, T0);
  assert.equal(newTally(T0 + HOUR_MS).start, T0 + HOUR_MS);
  const done = tally({ triggers: 1, inspected: 1, outcomes: { ...newTally(T0).outcomes, alarm: 1 } });
  assert.equal(tallyDue(done, T0 + HOUR_MS - 1), false);
  assert.equal(tallyDue(done, T0 + HOUR_MS), true);
  const open = tally({ triggers: 1, inspected: 1 });
  assert.equal(tallyDue(open, T0 + HOUR_MS + 60 * SEC), false);
  assert.equal(tallyDue(open, T0 + HOUR_MS + TALLY_GRACE_MS - 1), false);
  assert.equal(tallyDue(open, T0 + HOUR_MS + TALLY_GRACE_MS), true);
});

/* ------------------------------------------------------------------ Takt */

const input = (now: number, cams: number[], o: Partial<TickInput> = {}): TickInput => ({
  now,
  hour: 23,
  nightWindow: "22-6",
  maxPerHour: 30,
  maxBusy: 2,
  events: cams.map((camId) => ({
    ev: { kind: "camera", title: "PERSON erkannt", where: `Kamera ${camId}` },
    camId,
    where: `Kamera ${camId}`,
    closed: true,
    always: false,
  })),
  ...o,
});
const cams = (plan: { start: StartedInspection[] }) => plan.start.map((s) => s.trigger.camId);

test("Zwei Bewertungen laufen, der dritte Ausloeser wartet und wird im naechsten freien Takt genau einmal bewertet", () => {
  const q = newQueue(T0);
  const first = planTick(q, input(T0 + SEC, [1, 2, 3]));
  assert.deepEqual(cams(first), [1, 2]);
  assert.equal(q.busy, 2);
  assert.deepEqual(q.waiting.map((w) => w.camId), [3]);
  // Solange beide Plaetze belegt sind, wartet er weiter.
  for (const s of [4, 7, 10]) assert.deepEqual(cams(planTick(q, input(T0 + s * SEC, []))), []);
  assert.deepEqual(q.waiting.map((w) => w.camId), [3]);
  // Ein Platz wird frei: Im naechsten Takt ist er dran.
  finishInspection(q, first.start[0], "unauffaellig", 23, "22-6");
  const retry = planTick(q, input(T0 + 13 * SEC, []));
  assert.deepEqual(cams(retry), [3]);
  assert.equal(retry.start[0].trigger.seenAt, T0 + SEC);
  assert.deepEqual(q.waiting, []);
  // Danach taucht er nie wieder auf.
  finishInspection(q, first.start[1], "alarm", 23, "22-6");
  finishInspection(q, retry.start[0], "alarm", 23, "22-6");
  for (const s of [16, 19, 40, 100]) assert.deepEqual(cams(planTick(q, input(T0 + s * SEC, []))), []);
  assert.equal(q.busy, 0);
  assert.deepEqual([q.tally.triggers, q.tally.inspected, tallyOpen(q.tally)], [3, 3, 0]);
  assert.deepEqual(q.tally.skipped, { abstand: 0, limit: 0, belegt: 0 });
});

test("Wartender Ausloeser verfaellt nach 30 Sekunden und zaehlt als belegt", () => {
  const q = newQueue(T0);
  planTick(q, input(T0 + SEC, [1, 2, 3]));
  let expired: number[] = [];
  for (let s = 4; s <= 34; s += 3) {
    const plan = planTick(q, input(T0 + s * SEC, []));
    assert.deepEqual(cams(plan), []);
    expired = expired.concat(plan.expired.map((w) => w.camId));
    // Bis 30 Sekunden nach dem Ausloeser wartet er noch.
    if (s < 31) assert.deepEqual(q.waiting.map((w) => w.camId), [3], `${s} s`);
  }
  assert.deepEqual(expired, [3]);
  assert.deepEqual(q.waiting, []);
  assert.deepEqual(q.tally.skipped, { abstand: 0, limit: 0, belegt: 1 });
  assert.deepEqual([q.tally.triggers, q.tally.inspected], [3, 2]);
});

test("Wartet fuer eine Kamera schon ein Ausloeser, kommt kein zweiter dazu", () => {
  const q = newQueue(T0);
  const first = planTick(q, input(T0 + SEC, [1, 2, 3]));
  const again = planTick(q, input(T0 + 4 * SEC, [3, 3, 4]));
  assert.deepEqual(cams(again), []);
  assert.deepEqual(q.waiting.map((w) => w.camId), [3, 4]);
  assert.deepEqual(again.skipped, { abstand: 0, limit: 0, belegt: 2 });
  // Beide Plaetze frei: Die wartenden kommen in der Reihenfolge ihres Eintreffens dran, je einmal.
  for (const s of first.start) finishInspection(q, s, "alarm", 23, "22-6");
  const next = planTick(q, input(T0 + 7 * SEC, [3, 4]));
  assert.deepEqual(cams(next), [3, 4]);
  // Die neuen Ereignisse derselben Kameras fallen unter deren Sperrzeit.
  assert.deepEqual(next.skipped, { abstand: 2, limit: 0, belegt: 0 });
  assert.equal(q.tally.triggers, 3 + 3 + 2);
  assert.equal(q.tally.inspected, 4);
});

test("Zwei Ausloeser derselben Kamera im selben Takt: nur einer wird bewertet", () => {
  const q = newQueue(T0);
  const plan = planTick(q, input(T0 + SEC, [1, 1]));
  assert.deepEqual(cams(plan), [1]);
  assert.deepEqual(plan.skipped, { abstand: 1, limit: 0, belegt: 0 });
  assert.equal(plan.triggers, 2);
});

test("Sperrzeit je Kamera: lang, solange die Bewertung laeuft, danach nach dem Ergebnis", () => {
  const q = newQueue(T0);
  const first = planTick(q, input(T0, [1]));
  // Die Bewertung laeuft noch: weitere Ausloeser der Kamera fallen unter die 3 Minuten.
  assert.deepEqual(planTick(q, input(T0 + 50 * SEC, [1])).skipped, { abstand: 1, limit: 0, belegt: 0 });
  assert.equal(q.marks.get(1)?.cooldownMs, COOLDOWN_MS);
  // Leeres Ergebnis in der Nacht: 45 Sekunden ab Beginn der Bewertung.
  finishInspection(q, first.start[0], "unauffaellig", 23, "22-6");
  assert.equal(q.marks.get(1)?.cooldownMs, EMPTY_COOLDOWN_MS);
  const second = planTick(q, input(T0 + 144 * SEC, [1]));
  assert.deepEqual(cams(second), [1]);
  // Sie ist vorgezogen: Mit der langen Sperrzeit haette es sie noch nicht gegeben.
  assert.deepEqual([first.start[0].early, second.start[0].early, q.tally.early], [false, true, 1]);
  // Alarm: wieder 3 Minuten, gerechnet ab dem Beginn der zweiten Bewertung.
  finishInspection(q, second.start[0], "alarm", 23, "22-6");
  assert.deepEqual(cams(planTick(q, input(T0 + (144 + 179) * SEC, [1]))), []);
  assert.deepEqual(cams(planTick(q, input(T0 + (144 + 181) * SEC, [1]))), [1]);
});

test("Leeres Ergebnis: nachts nach 44 s noch gesperrt, nach 46 s wieder dran; am Tag erst nach 3 Minuten", () => {
  for (const outcome of EMPTY) {
    const night = newQueue(T0);
    finishInspection(night, planTick(night, input(T0, [1])).start[0], outcome, 23, "22-6");
    assert.deepEqual(cams(planTick(night, input(T0 + 44 * SEC, [1]))), [], outcome);
    assert.deepEqual(cams(planTick(night, input(T0 + 46 * SEC, [1]))), [1], outcome);

    const day = newQueue(T0);
    finishInspection(day, planTick(day, input(T0, [1], { hour: 14 })).start[0], outcome, 14, "22-6");
    assert.deepEqual(cams(planTick(day, input(T0 + 46 * SEC, [1], { hour: 14 }))), [], outcome);
    assert.deepEqual(cams(planTick(day, input(T0 + 181 * SEC, [1], { hour: 14 }))), [1], outcome);
    // Am Tag ist keine Bewertung vorgezogen.
    assert.deepEqual([day.recent.length, day.early.length, day.tally.early], [2, 0, 0], outcome);
  }
});

test("Das Ergebnis einer aelteren Bewertung aendert die Sperrzeit einer neueren nicht", () => {
  const q = newQueue(T0);
  const slow = planTick(q, input(T0, [1]));
  // Die erste Bewertung dauert laenger als 3 Minuten, die Kamera loest wieder aus.
  const next = planTick(q, input(T0 + 200 * SEC, [1]));
  assert.deepEqual(cams(next), [1]);
  finishInspection(q, slow.start[0], "fehler", 23, "22-6");
  assert.equal(q.marks.get(1), next.start[0].mark);
  assert.equal(q.marks.get(1)?.cooldownMs, COOLDOWN_MS);
  assert.deepEqual(planTick(q, input(T0 + 260 * SEC, [1])).skipped, { abstand: 1, limit: 0, belegt: 0 });
  assert.equal(q.busy, 1);
});

test("Stundenlimit ueber alle Kameras, auch fuer wartende Ausloeser", () => {
  const q = newQueue(T0);
  const first = planTick(q, input(T0, [1, 2, 3, 4], { maxPerHour: 3 }));
  assert.deepEqual(cams(first), [1, 2]);
  // Kamera 3 und 4 kamen vor dem Limit an und warten auf einen Platz.
  assert.deepEqual(q.waiting.map((w) => w.camId), [3, 4]);
  for (const s of first.start) finishInspection(q, s, "alarm", 23, "22-6");
  // Mit Kamera 3 ist das Limit erreicht: Kamera 4 und ein neuer Ausloeser werden uebergangen.
  const plan = planTick(q, input(T0 + 3 * SEC, [5], { maxPerHour: 3 }));
  assert.deepEqual(cams(plan), [3]);
  assert.deepEqual(plan.skipped, { abstand: 0, limit: 2, belegt: 0 });
  assert.deepEqual(q.waiting, []);
  // Eine Stunde spaeter zaehlen die alten Bewertungen nicht mehr.
  finishInspection(q, plan.start[0], "alarm", 23, "22-6");
  assert.deepEqual(cams(planTick(q, input(T0 + HOUR_MS + 4 * SEC, [5], { hour: 0, maxPerHour: 3 }))), [5]);
});

const mark = (o: Partial<InspectMark> = {}): InspectMark => ({ at: T0, cooldownMs: EMPTY_COOLDOWN_MS, regularAt: T0, running: false, ...o });

test("Vorgezogen ist, was weniger als 3 Minuten nach der letzten nicht vorgezogenen Bewertung beginnt", () => {
  assert.equal(isEarly(undefined, T0), false);
  assert.equal(isEarly(mark(), T0 + 46 * SEC), true);
  assert.equal(isEarly(mark(), T0 + 179 * SEC), true);
  assert.equal(isEarly(mark(), T0 + 180 * SEC), false);
  // Nach einem vorgezogenen Blick zaehlt weiter der Beginn der Bewertung davor.
  const second = mark({ at: T0 + 100 * SEC });
  assert.equal(isEarly(second, T0 + 150 * SEC), true);
  assert.equal(isEarly(second, T0 + 180 * SEC), false);
});

test("Geltende Sperrzeit: lang, solange das Ergebnis aussteht; danach nach dem Ergebnis, hoechstens bis zum Takt der langen", () => {
  assert.equal(lockMs(mark({ running: true, cooldownMs: COOLDOWN_MS })), COOLDOWN_MS);
  assert.equal(lockMs(mark()), EMPTY_COOLDOWN_MS);
  assert.equal(lockMs(mark({ cooldownMs: COOLDOWN_MS })), COOLDOWN_MS);
  // Vorgezogener Blick 100 s nach der letzten nicht vorgezogenen Bewertung, leer: 45 s.
  assert.equal(lockMs(mark({ at: T0 + 100 * SEC })), EMPTY_COOLDOWN_MS);
  // 150 s danach, leer: Der Takt der langen Sperrzeit ist nach 30 s wieder dran.
  assert.equal(lockMs(mark({ at: T0 + 150 * SEC })), 30 * SEC);
  // Vorgezogener Blick mit „kein Alarm“: keine weiteren vorgezogenen Blicke, der Takt der langen laeuft weiter.
  assert.equal(lockMs(mark({ at: T0 + 50 * SEC, cooldownMs: COOLDOWN_MS })), 130 * SEC);
  // Vorgezogener Blick mit Alarm: Der Takt beginnt neu.
  assert.equal(lockMs(mark({ at: T0 + 50 * SEC, cooldownMs: COOLDOWN_MS, regularAt: T0 + 50 * SEC })), COOLDOWN_MS);
  // Laesst das Stundenlimit keine vorgezogenen Blicke mehr zu, gilt nur der Takt der langen Sperrzeit.
  assert.equal(lockMs(mark(), false), COOLDOWN_MS);
  assert.equal(lockMs(mark({ at: T0 + 100 * SEC }), false), 80 * SEC);
  assert.equal(lockMs(mark({ running: true, cooldownMs: COOLDOWN_MS }), false), COOLDOWN_MS);
});

test("Auf das Ergebnis wird nur gewartet, wenn ein vorgezogener Blick laeuft und der Takt der langen Sperrzeit dran ist", () => {
  const running = mark({ at: T0 + 170 * SEC, cooldownMs: COOLDOWN_MS, running: true });
  assert.equal(awaitsResult(undefined, T0), false);
  assert.equal(awaitsResult(running, T0 + 175 * SEC), false);
  assert.equal(awaitsResult(running, T0 + 181 * SEC), true);
  assert.equal(awaitsResult({ ...running, running: false }, T0 + 181 * SEC), false);
  // Eine Bewertung, die nicht vorgezogen war und noch laeuft: nach 3 Minuten ist die Kamera ohnehin wieder dran.
  assert.equal(awaitsResult(mark({ running: true, cooldownMs: COOLDOWN_MS }), T0 + 100 * SEC), false);
  assert.equal(awaitsResult(mark({ running: true, cooldownMs: COOLDOWN_MS }), T0 + 181 * SEC), false);
});

test("Vorgezogene Bewertungen nutzen nur den Rest des Stundenlimits und nehmen den uebrigen nichts weg", () => {
  const q = newQueue(T0);
  const opts = { maxPerHour: 5 };
  // Kamera 1 loest in der Nacht alle 46 s aus, das Bild ist jedes Mal leer.
  const look = (s: number, camIds: number[]) => {
    const plan = planTick(q, input(T0 + s * SEC, camIds, opts));
    for (const st of plan.start) finishInspection(q, st, "unauffaellig", 23, "22-6");
    return plan;
  };
  for (const s of [0, 46, 92, 138]) assert.deepEqual(cams(look(s, [1])), [1], `${s} s`);
  assert.deepEqual([q.recent.length, q.early.length], [1, 3]);
  // Nach 3 Minuten ist der Takt der langen Sperrzeit dran: Diese Bewertung ist nicht vorgezogen.
  assert.equal(look(184, [1]).start[0]?.early, false);
  assert.deepEqual([q.recent.length, q.early.length], [2, 3]);
  // Zusammen sind es 5: Fuer einen weiteren vorgezogenen Blick ist kein Rest mehr da, es gilt die lange Sperrzeit.
  assert.deepEqual(look(230, [1]).skipped, { abstand: 1, limit: 0, belegt: 0 });
  // Andere Kameras werden weiter bewertet, als haette es die vorgezogenen Blicke nicht gegeben.
  assert.deepEqual(cams(look(231, [2, 3])), [2, 3]);
  assert.deepEqual([q.recent.length, q.early.length], [4, 3]);
  // Kamera 1 selbst ist 3 Minuten nach ihrer letzten nicht vorgezogenen Bewertung wieder dran, vorher nicht.
  assert.deepEqual(look(184 + 179, [1]).skipped, { abstand: 1, limit: 0, belegt: 0 });
  const regular = look(184 + 180, [1]);
  assert.deepEqual(cams(regular), [1]);
  assert.equal(regular.start[0].early, false);
  assert.deepEqual([q.recent.length, q.early.length], [5, 3]);
  // Erst jetzt liegen auch ohne die vorgezogenen 5 Bewertungen in der Stunde: Schluss fuer alle.
  assert.deepEqual(look(400, [4]).skipped, { abstand: 0, limit: 1, belegt: 0 });
  // Eine Stunde spaeter zaehlen die alten Bewertungen nicht mehr, auch die vorgezogenen nicht.
  const later = planTick(q, input(T0 + HOUR_MS + 410 * SEC, [1, 5], { ...opts, hour: 0 }));
  assert.deepEqual(cams(later), [1, 5]);
  assert.deepEqual([q.recent.length, q.early.length], [2, 0]);
  assert.equal(q.closing.length, 1);
  assert.equal(
    tallyLine(q.closing[0], 23),
    "Wächter 23–0 Uhr: 11 Auslöser, 8 bewertet (davon 3 nach kurzer Sperrzeit), 3 übergangen (Abstand 2, Limit 1, belegt 0); 8 unauffällig",
  );
});

test("Die kurze Sperrzeit verschiebt den Takt der langen nicht", () => {
  const q = newQueue(T0);
  const look = (s: number, outcome: InspectOutcome = "unauffaellig") => {
    const plan = planTick(q, input(T0 + s * SEC, [1]));
    for (const st of plan.start) finishInspection(q, st, outcome, 23, "22-6");
    return plan;
  };
  // Leere Blicke nach 50, 100 und 150 s. Der letzte wuerde die Kamera bis 195 s sperren.
  assert.deepEqual([0, 50, 100, 150].map((s) => look(s).start[0]?.early), [false, true, true, true]);
  assert.deepEqual(look(179).skipped, { abstand: 1, limit: 0, belegt: 0 });
  // 3 Minuten nach der ersten Bewertung ist die Kamera wieder dran, wie ohne die vorgezogenen Blicke.
  const due = look(181);
  assert.equal(due.start[0]?.early, false);
  assert.equal(q.marks.get(1)?.regularAt, T0 + 181 * SEC);
  // Von dort zaehlt der Takt neu.
  assert.equal(look(181 + 46).start[0]?.early, true);
  assert.equal(look(181 + 180).start[0]?.early, false);
});

test("Vorgezogener Blick mit Alarm: danach 3 Minuten Ruhe an der Kamera", () => {
  const q = newQueue(T0);
  finishInspection(q, planTick(q, input(T0, [1])).start[0], "tracker_leer", 23, "22-6");
  const second = planTick(q, input(T0 + 50 * SEC, [1]));
  assert.equal(second.start[0]?.early, true);
  finishInspection(q, second.start[0], "alarm", 23, "22-6");
  for (const s of [100, 181, 229]) assert.deepEqual(planTick(q, input(T0 + s * SEC, [1])).skipped, { abstand: 1, limit: 0, belegt: 0 }, `${s} s`);
  assert.equal(planTick(q, input(T0 + 230 * SEC, [1])).start[0]?.early, false);
});

test("Vorgezogener Blick mit „kein Alarm“: keine weiteren vorgezogenen Blicke, der Takt der langen Sperrzeit bleibt", () => {
  const q = newQueue(T0);
  finishInspection(q, planTick(q, input(T0, [1])).start[0], "unauffaellig", 23, "22-6");
  const second = planTick(q, input(T0 + 50 * SEC, [1]));
  finishInspection(q, second.start[0], "kein_alarm", 23, "22-6");
  for (const s of [96, 140, 179]) assert.deepEqual(planTick(q, input(T0 + s * SEC, [1])).skipped, { abstand: 1, limit: 0, belegt: 0 }, `${s} s`);
  assert.equal(planTick(q, input(T0 + 180 * SEC, [1])).start[0]?.early, false);
});

test("Laeuft ein vorgezogener Blick, wartet der Ausloeser des langen Takts auf dessen Ergebnis", () => {
  const start = () => {
    const q = newQueue(T0);
    finishInspection(q, planTick(q, input(T0, [1])).start[0], "unauffaellig", 23, "22-6");
    const early = planTick(q, input(T0 + 171 * SEC, [1])).start[0];
    assert.equal(early.early, true);
    // 183 s: Der Takt der langen Sperrzeit ist dran, der vorgezogene Blick laeuft noch.
    const plan = planTick(q, input(T0 + 183 * SEC, [1]));
    assert.deepEqual([cams(plan), plan.triggers, q.waiting.map((w) => w.camId)], [[], 1, [1]]);
    assert.deepEqual(plan.skipped, { abstand: 0, limit: 0, belegt: 0 });
    // Ein weiterer Ausloeser derselben Kamera kommt nicht dazu.
    assert.deepEqual(planTick(q, input(T0 + 186 * SEC, [1])).skipped, { abstand: 1, limit: 0, belegt: 0 });
    return { q, early };
  };
  // Der vorgezogene Blick war leer: Der wartende Ausloeser wird bewertet, genau einmal.
  const a = start();
  finishInspection(a.q, a.early, "unauffaellig", 23, "22-6");
  const next = planTick(a.q, input(T0 + 189 * SEC, []));
  assert.deepEqual([cams(next), next.start[0].early, next.start[0].trigger.seenAt], [[1], false, T0 + 183 * SEC]);
  assert.deepEqual(a.q.waiting, []);
  // Er endete mit einem Alarm: Der wartende Ausloeser faellt unter die 3 Minuten danach.
  const b = start();
  finishInspection(b.q, b.early, "alarm", 23, "22-6");
  const skipped = planTick(b.q, input(T0 + 189 * SEC, []));
  assert.deepEqual([cams(skipped), skipped.skipped, skipped.expired], [[], { abstand: 1, limit: 0, belegt: 0 }, []]);
  // Er laeuft laenger als 30 Sekunden: Der wartende Ausloeser verfaellt (Abstand, die Kamera wird gerade angesehen).
  const c = start();
  for (const s of [189, 201, 210]) assert.deepEqual(planTick(c.q, input(T0 + s * SEC, [])).skipped, { abstand: 0, limit: 0, belegt: 0 }, `${s} s`);
  const gone = planTick(c.q, input(T0 + 213 * SEC, []));
  assert.deepEqual([gone.skipped, gone.expired, c.q.waiting], [{ abstand: 1, limit: 0, belegt: 0 }, [], []]);
  assert.equal(tallyOpen(c.q.tally), 1);
});

test("Was die lange Sperrzeit allein bewertet haette, wird weiter bewertet; die kurzen Blicke kommen dazu", () => {
  let seed = 4711;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const calm: InspectOutcome[] = ["kein_alarm", "unauffaellig", "tracker_leer", "nahaufnahme_leer", "fehler"];
  let earlyTotal = 0;
  for (let round = 0; round < 60; round++) {
    const maxPerHour = round % 3 === 0 ? 8 : 1000;
    const q = newQueue(T0);
    // Vergleich: nur die lange Sperrzeit ab Beginn der letzten Bewertung, dazu das Stundenlimit.
    const last = new Map<number, number>();
    const recent: number[] = [];
    const expected: string[] = [];
    const regular: string[] = [];
    for (let step = 0; step < 3600; step++) {
      const now = T0 - 2 * HOUR_MS + step * 3 * SEC;
      // Von 21 bis 24 Uhr Ortszeit (ab 22 Uhr Nachtfenster), alle Kameras in geschlossenen Raeumen.
      const hour = now < T0 - HOUR_MS ? 21 : now < T0 ? 22 : 23;
      const events = [1, 2, 3].filter(() => rnd() < 0.2);
      while (recent.length && now - recent[0] > HOUR_MS) recent.shift();
      for (const cam of events) {
        const l = last.get(cam);
        if ((l !== undefined && now - l < COOLDOWN_MS) || recent.length >= maxPerHour) continue;
        last.set(cam, now);
        recent.push(now);
        expected.push(`${cam}@${step}`);
      }
      const plan = planTick(q, input(now, events, { hour, maxPerHour, maxBusy: 99 }));
      for (const s of plan.start) {
        // Vor dem Nachtfenster gibt es keine vorgezogenen Blicke.
        if (s.early) assert.notEqual(hour, 21);
        if (s.early) earlyTotal++;
        else regular.push(`${s.trigger.camId}@${step}`);
        // Jede Bewertung ist vor dem naechsten Takt fertig; vorgezogene enden hier nie mit Alarm.
        finishInspection(q, s, s.early ? calm[Math.floor(rnd() * calm.length)] : OUTCOMES[Math.floor(rnd() * OUTCOMES.length)], hour, "22-6");
      }
    }
    assert.deepEqual(regular, expected, `Runde ${round}`);
    assert.ok(expected.length > 20);
  }
  assert.ok(earlyTotal > 200, `vorgezogen: ${earlyTotal}`);
});

test("Vorgezogene Blicke belegen beide Plaetze: Der Ausloeser der dritten Kamera verfaellt nicht und wird bewertet, sobald ein Platz frei ist", () => {
  const q = newQueue(T0);
  // Kamera 1 und 2 loesen aus, beide Bilder sind leer.
  const a = planTick(q, input(T0, [1])).start[0];
  const b = planTick(q, input(T0 + 3 * SEC, [2])).start[0];
  finishInspection(q, a, "unauffaellig", 23, "22-6");
  finishInspection(q, b, "tracker_leer", 23, "22-6");
  // 48 s und 51 s: Beide loesen wieder aus, es beginnen zwei vorgezogene Blicke.
  const early1 = planTick(q, input(T0 + 48 * SEC, [1])).start[0];
  const early2 = planTick(q, input(T0 + 51 * SEC, [2])).start[0];
  assert.deepEqual([early1.early, early2.early, q.busy, q.busyEarly], [true, true, 2, 2]);
  // 60 s: Kamera 3 loest zum ersten Mal aus und wartet auf einen Platz.
  assert.deepEqual(cams(planTick(q, input(T0 + 60 * SEC, [3]))), []);
  // Auch nach mehr als 30 Sekunden wartet sie noch: Die Plaetze halten vorgezogene Blicke.
  for (let s = 63; s <= 117; s += 3) {
    const plan = planTick(q, input(T0 + s * SEC, []));
    assert.deepEqual([cams(plan), plan.expired, q.waiting.map((w) => w.camId)], [[], [], [3]], `${s} s`);
  }
  assert.deepEqual(q.tally.skipped, { abstand: 0, limit: 0, belegt: 0 });
  // Der erste vorgezogene Blick endet: Im naechsten Takt ist Kamera 3 dran, als Bewertung des langen Takts.
  finishInspection(q, early1, "alarm", 23, "22-6");
  assert.equal(q.busyEarly, 1);
  const next = planTick(q, input(T0 + 120 * SEC, []));
  assert.deepEqual([cams(next), next.start[0].early, next.start[0].trigger.seenAt], [[3], false, T0 + 60 * SEC]);
  assert.deepEqual([q.waiting, q.busy, q.busyEarly], [[], 2, 1]);
  finishInspection(q, early2, "alarm", 23, "22-6");
  finishInspection(q, next.start[0], "alarm", 23, "22-6");
  assert.deepEqual([q.busy, q.busyEarly, tallyOpen(q.tally)], [0, 0, 0]);
  assert.deepEqual([q.tally.triggers, q.tally.inspected, q.tally.early], [5, 5, 2]);
});

test("Halten nur noch Bewertungen des langen Takts die Plaetze, verfaellt der wartende Ausloeser 30 Sekunden spaeter", () => {
  const q = newQueue(T0);
  finishInspection(q, planTick(q, input(T0, [1])).start[0], "unauffaellig", 23, "22-6");
  // Ein vorgezogener Blick auf Kamera 1 und eine Bewertung von Kamera 2 laufen, Kamera 3 und 4 warten.
  const early = planTick(q, input(T0 + 48 * SEC, [1])).start[0];
  const regular = planTick(q, input(T0 + 51 * SEC, [2])).start[0];
  assert.deepEqual([early.early, regular.early], [true, false]);
  planTick(q, input(T0 + 54 * SEC, [3, 4]));
  assert.deepEqual(q.waiting.map((w) => w.camId), [3, 4]);
  for (let s = 57; s <= 96; s += 3) assert.deepEqual(planTick(q, input(T0 + s * SEC, [])).expired, [], `${s} s`);
  // Der vorgezogene Blick endet: Kamera 3 bekommt den Platz, Kamera 4 wartet weiter.
  finishInspection(q, early, "unauffaellig", 23, "22-6");
  assert.deepEqual(cams(planTick(q, input(T0 + 99 * SEC, []))), [3]);
  assert.deepEqual(q.waiting.map((w) => w.camId), [4]);
  // Ab jetzt haelt kein vorgezogener Blick mehr einen Platz: Fuer Kamera 4 laufen die 30 Sekunden ab dem letzten Takt mit ihm (96 s).
  let expired: number[] = [];
  for (let s = 102; s <= 126; s += 3) {
    const plan = planTick(q, input(T0 + s * SEC, []));
    expired = expired.concat(plan.expired.map((w) => w.camId));
    if (s < 126) assert.deepEqual(q.waiting.map((w) => w.camId), [4], `${s} s`);
  }
  assert.deepEqual(expired, [4]);
  assert.deepEqual(q.tally.skipped, { abstand: 0, limit: 0, belegt: 1 });
});

test("Ein wartender Ausloeser, der selbst nur einen vorgezogenen Blick braechte, verfaellt wie bisher nach 30 Sekunden", () => {
  const q = newQueue(T0);
  finishInspection(q, planTick(q, input(T0, [1])).start[0], "unauffaellig", 23, "22-6");
  finishInspection(q, planTick(q, input(T0 + 3 * SEC, [3])).start[0], "unauffaellig", 23, "22-6");
  // Vorgezogener Blick auf Kamera 1 und Bewertung von Kamera 2 laufen.
  planTick(q, input(T0 + 48 * SEC, [1]));
  planTick(q, input(T0 + 51 * SEC, [2]));
  assert.deepEqual([q.busy, q.busyEarly], [2, 1]);
  // Kamera 3 loest 51 s nach ihrem leeren Bild wieder aus: Das waere ein vorgezogener Blick, er wartet auf einen Platz.
  planTick(q, input(T0 + 54 * SEC, [3]));
  assert.deepEqual(q.waiting.map((w) => w.camId), [3]);
  let expired: number[] = [];
  for (let s = 57; s <= 84; s += 3) expired = expired.concat(planTick(q, input(T0 + s * SEC, [])).expired.map((w) => w.camId));
  assert.deepEqual([expired, q.waiting], [[3], []]);
});

test("Zwei Plaetze, Bewertungen von 15 bis 90 s: Kein Ausloeser des langen Takts verfaellt, solange ein vorgezogener Blick einen Platz haelt", () => {
  let seed = 815;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  let earlyTotal = 0;
  let bothEarly = 0;
  let lateStarts = 0;
  let expiredTotal = 0;
  for (let round = 0; round < 40; round++) {
    const q = newQueue(T0);
    const running: Array<{ s: StartedInspection; until: number; outcome: InspectOutcome }> = [];
    /** Je wartendem Ausloeser: letzter Takt, in dem er dem langen Takt angehoerte und ein vorgezogener Blick lief. */
    const held = new Map<object, number>();
    // Eine Stunde im Nachtfenster, vier Kameras in geschlossenen Raeumen.
    for (let step = 0; step < 1200; step++) {
      const now = T0 + step * 3 * SEC;
      for (let i = running.length - 1; i >= 0; i--) {
        if (running[i].until > now) continue;
        finishInspection(q, running[i].s, running[i].outcome, 23, "22-6");
        running.splice(i, 1);
      }
      const earlyRunning = running.filter((r) => r.s.early).length;
      assert.equal(q.busyEarly, earlyRunning);
      if (earlyRunning === 2) bothEarly++;
      for (const w of q.waiting) if (earlyRunning > 0 && !isEarly(q.marks.get(w.camId), now)) held.set(w, now);
      const events = [1, 2, 3, 4].filter(() => rnd() < 0.02);
      const plan = planTick(q, input(now, events, { maxPerHour: 1000 }));
      for (const w of plan.expired) {
        expiredTotal++;
        // Verfallen ist er fruehestens 30 Sekunden nach dem letzten Takt, in dem ein vorgezogener Blick einen Platz hielt.
        assert.ok(now - w.seenAt >= RETRY_MAX_AGE_MS);
        assert.ok(!held.has(w) || now - held.get(w)! >= RETRY_MAX_AGE_MS, `Runde ${round}, Takt ${step}: Kamera ${w.camId} verfallen`);
      }
      for (const s of plan.start) {
        if (s.early) earlyTotal++;
        // Laenger als 30 Sekunden hat nur gewartet, wem ein vorgezogener Blick den Platz hielt; er wird nie selbst vorgezogen bewertet.
        if (now - s.trigger.seenAt >= RETRY_MAX_AGE_MS) {
          lateStarts++;
          assert.ok(held.has(s.trigger) && now - held.get(s.trigger)! < RETRY_MAX_AGE_MS, `Runde ${round}, Takt ${step}: Kamera ${s.trigger.camId}`);
          assert.equal(s.early, false);
        }
        running.push({ s, until: now + (15 + Math.floor(rnd() * 76)) * SEC, outcome: OUTCOMES[Math.floor(rnd() * OUTCOMES.length)] });
      }
      assert.ok(running.length <= 2 && q.busy === running.length);
    }
  }
  // Die Folgen enthalten alle Faelle: zwei vorgezogene Blicke zugleich, spaet nachgeholte und verfallene Ausloeser.
  assert.ok(earlyTotal > 100, `vorgezogen: ${earlyTotal}`);
  assert.ok(bothEarly > 20, `beide Plaetze vorgezogen: ${bothEarly}`);
  assert.ok(lateStarts > 0, `nach mehr als 30 s bewertet: ${lateStarts}`);
  assert.ok(expiredTotal > 0, `verfallen: ${expiredTotal}`);
});

test("Im Betrieb und am Tag ohne Betriebszeit gibt es keine Ausloeser und keine Bilanz", () => {
  const q = newQueue(T0);
  const open = input(T0, [1, 2]).events.map((e) => ({ ...e, closed: false }));
  const none = input(T0, [3]).events.map((e) => ({ ...e, closed: null }));
  const plan = planTick(q, input(T0, [], { hour: 14, events: [...open, ...none] }));
  assert.deepEqual(cams(plan), []);
  assert.equal(plan.triggers, 0);
  assert.equal(q.tally.triggers, 0);
  assert.deepEqual(dueTallies(q, T0 + HOUR_MS + SEC), []);
  assert.deepEqual(dueTallies(q, T0 + 5 * HOUR_MS), []);
});

test("Bilanz je Stunde: Zahlen gehen auf, eine Zeile, erst wenn alles erledigt ist", () => {
  const q = newQueue(T0);
  const a = planTick(q, input(T0 + 60 * SEC, [1, 2, 3]));
  finishInspection(q, a.start[0], "alarm", 23, "22-6");
  finishInspection(q, a.start[1], "unauffaellig", 23, "22-6");
  const b = planTick(q, input(T0 + 63 * SEC, [1]));
  assert.deepEqual(cams(b), [3]);
  // Kurz vor der vollen Stunde kommt noch ein Ausloeser; sein Ergebnis faellt in die naechste Stunde.
  const c = planTick(q, input(T0 + HOUR_MS - 5 * SEC, [4]));
  finishInspection(q, b.start[0], "tracker_leer", 23, "22-6");
  assert.deepEqual(dueTallies(q, T0 + HOUR_MS - SEC), []);
  // Die Stunde ist vorbei, eine Bewertung laeuft noch: keine Zeile.
  assert.deepEqual(dueTallies(q, T0 + HOUR_MS + 3 * SEC), []);
  // In der neuen Stunde kommt ein weiterer Ausloeser dazu.
  const d = planTick(q, input(T0 + HOUR_MS + 6 * SEC, [5], { hour: 0 }));
  finishInspection(q, c.start[0], "kein_alarm", 0, "22-6");
  const due = dueTallies(q, T0 + HOUR_MS + 9 * SEC);
  assert.equal(due.length, 1);
  assert.equal(
    tallyLine(due[0], 23),
    "Wächter 23–0 Uhr: 5 Auslöser, 4 bewertet, 1 übergangen (Abstand 1, Limit 0, belegt 0); 1 Alarm, 1 kein Alarm, 1 unauffällig, 1 Tracker leer",
  );
  // Keine zweite Zeile fuer dieselbe Stunde.
  assert.deepEqual(dueTallies(q, T0 + HOUR_MS + 12 * SEC), []);
  // Die naechste Stunde bekommt ihre eigene Zeile.
  finishInspection(q, d.start[0], "alarm", 0, "22-6");
  const next = dueTallies(q, T0 + 2 * HOUR_MS + SEC);
  assert.equal(next.length, 1);
  assert.equal(tallyLine(next[0], 0), "Wächter 0–1 Uhr: 1 Auslöser, 1 bewertet, 0 übergangen; 1 Alarm");
  assert.deepEqual(dueTallies(q, T0 + 3 * HOUR_MS + SEC), []);
});

test("Bilanz wartet hoechstens 10 Minuten auf eine haengende Bewertung", () => {
  const q = newQueue(T0);
  planTick(q, input(T0 + 60 * SEC, [1]));
  assert.deepEqual(dueTallies(q, T0 + HOUR_MS + TALLY_GRACE_MS - SEC), []);
  const due = dueTallies(q, T0 + HOUR_MS + TALLY_GRACE_MS);
  assert.equal(due.length, 1);
  assert.equal(tallyLine(due[0], 23), "Wächter 23–0 Uhr: 1 Auslöser, 1 bewertet, 0 übergangen; 1 noch offen");
});

test("Zufaellige Folgen: kein Ausloeser doppelt, nie mehr als zwei Bewertungen, die Zahlen gehen auf", () => {
  // Kleiner fester Zufallsgenerator, damit der Test immer gleich laeuft.
  let seed = 20260115;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let round = 0; round < 40; round++) {
    const q: SentinelQueue = newQueue(T0);
    const running: Array<{ s: StartedInspection; until: number }> = [];
    const startedTriggers = new Set<object>();
    const tallies = new Set<SentinelTally>([q.tally]);
    let triggers = 0;
    let earlyStarts = 0;
    let now = T0;
    for (let step = 0; step < 400; step++) {
      now += 3 * SEC;
      // Fertige Bewertungen verbuchen.
      for (let i = running.length - 1; i >= 0; i--) {
        if (running[i].until > now) continue;
        finishInspection(q, running[i].s, OUTCOMES[Math.floor(rnd() * OUTCOMES.length)], 23, "22-6");
        running.splice(i, 1);
      }
      const events = [1, 2, 3, 4, 5].filter(() => rnd() < 0.12);
      const plan = planTick(q, input(now, events, { maxPerHour: 25 }));
      tallies.add(q.tally);
      triggers += plan.triggers;
      for (const s of plan.start) {
        assert.equal(startedTriggers.has(s.trigger), false, "Ausloeser doppelt bewertet");
        startedTriggers.add(s.trigger);
        // Zurueckgestellte Ausloeser sind beim Start juenger als 30 Sekunden, ausser ein vorgezogener Blick hielt zuletzt einen Platz.
        assert.ok(now - Math.max(s.trigger.seenAt, s.trigger.heldAt ?? 0) < RETRY_MAX_AGE_MS);
        // Dieselbe Kamera wird nicht zweimal nebeneinander bewertet (ausser eine Bewertung laeuft laenger als 3 Minuten).
        for (const r of running) assert.ok(r.s.trigger.camId !== s.trigger.camId || now - r.s.mark.at >= COOLDOWN_MS, "zwei Bewertungen derselben Kamera");
        if (s.early) earlyStarts++;
        running.push({ s, until: now + (5 + Math.floor(rnd() * 90)) * SEC });
      }
      assert.ok(q.busy <= 2 && q.busy === running.length, `busy ${q.busy}, laufend ${running.length}`);
      // Das Stundenlimit: ohne die vorgezogenen hoechstens 25, vorgezogene nur aus dem Rest.
      assert.ok(q.recent.length <= 25);
      assert.ok(q.early.length <= 25);
      // Hoechstens ein wartender Ausloeser je Kamera.
      assert.equal(new Set(q.waiting.map((w) => w.camId)).size, q.waiting.length);
    }
    // Alles zu Ende bringen.
    for (const r of running) finishInspection(q, r.s, "alarm", 23, "22-6");
    planTick(q, input(now + 60 * SEC, []));
    tallies.add(q.tally);
    assert.equal(q.busy, 0);
    assert.deepEqual(q.waiting, []);
    let counted = 0;
    let inspected = 0;
    let early = 0;
    for (const t of tallies) {
      const skipped = t.skipped.abstand + t.skipped.limit + t.skipped.belegt;
      const results = OUTCOMES.reduce((n, o) => n + t.outcomes[o], 0);
      assert.equal(t.triggers, skipped + results, "Bilanz geht nicht auf");
      assert.equal(t.inspected, results);
      assert.equal(tallyOpen(t), 0);
      counted += t.triggers;
      inspected += t.inspected;
      early += t.early;
    }
    assert.equal(counted, triggers);
    assert.equal(inspected, startedTriggers.size);
    assert.equal(early, earlyStarts);
    assert.ok(triggers > 50, `zu wenige Ausloeser: ${triggers}`);
  }
});

/* ------------------------------------------------ Kennzeichen-Fragen neben dem Takt */

test("appendBacklog: Reihenfolge bleibt, höchstens max, die ältesten fallen weg und werden gezählt", () => {
  assert.deepEqual(appendBacklog([], [1, 2], 5), { list: [1, 2], dropped: 0 });
  assert.deepEqual(appendBacklog([1, 2], [3], 5), { list: [1, 2, 3], dropped: 0 });
  assert.deepEqual(appendBacklog([1, 2, 3], [4, 5], 5), { list: [1, 2, 3, 4, 5], dropped: 0 }, "genau voll");
  assert.deepEqual(appendBacklog([1, 2, 3, 4], [5, 6, 7], 5), { list: [3, 4, 5, 6, 7], dropped: 2 });
  // Mehr neue als Platz: nur die neuesten bleiben.
  assert.deepEqual(appendBacklog([1], [2, 3, 4, 5, 6, 7], 3), { list: [5, 6, 7], dropped: 4 });
  assert.deepEqual(appendBacklog([1, 2], [], 5), { list: [1, 2], dropped: 0 });
  assert.equal(VEHICLE_BACKLOG_MAX, 300);
  const full = appendBacklog(Array.from({ length: VEHICLE_BACKLOG_MAX }, (_, i) => i), [VEHICLE_BACKLOG_MAX]);
  assert.equal(full.list.length, VEHICLE_BACKLOG_MAX);
  assert.equal(full.dropped, 1);
  assert.equal(full.list[0], 1);
  assert.equal(full.list.at(-1), VEHICLE_BACKLOG_MAX);
});
