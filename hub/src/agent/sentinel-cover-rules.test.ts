import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COVER_TICK_MAX_AGE_MS,
  INSPECT_COVER_MAX_MS,
  cameraDuty,
  cloudQuietOn,
  coverageLine,
  coverageReport,
  coverageShrank,
  coveredCameras,
  dutyCovers,
  inspectionsInLastHour,
  vouchFor,
  vouchParam,
  type CameraDuty,
  type CoverInput,
  type VouchInput,
} from "./sentinel-cover-rules.js";
import { COOLDOWN_MS, HOUR_MS, finishInspection, lockMs, newQueue, planTick, type InspectOutcome, type SentinelQueue } from "./sentinel-rules.js";

const base: CoverInput = {
  enabled: true,
  paired: true,
  delivery: null,
  visionReady: true,
  visionFailStreak: 0,
  inspectionsLastHour: 0,
  maxPerHour: 30,
  always: false,
  hour: 23,
  nightWindow: "22-6",
  cams: [
    { id: 9, mode: "raum", roomClosed: true, duty: "frei" },
    { id: 8, mode: "raum", roomClosed: null, duty: "frei" },
    { id: 12, mode: "raum", roomClosed: false, duty: "frei" },
    { id: 3, mode: "nachts", roomClosed: false, duty: "frei" },
    { id: 5, mode: "aus", roomClosed: true, duty: "frei" },
  ],
};

test("nachts: geschlossene Räume, Kameras ohne Betriebszeit und „nur nachts“, nicht offen und nicht „aus“", () => {
  assert.deepEqual(coveredCameras(base), { cameras: [3, 8, 9], blocked: null, held: [] });
});

test("am Tag: nur geschlossene Räume; mit always alle „wie der Raum“, nicht „nur nachts“ und nicht „aus“", () => {
  assert.deepEqual(coveredCameras({ ...base, hour: 14 }).cameras, [9]);
  assert.deepEqual(coveredCameras({ ...base, hour: 14, always: true }).cameras, [8, 9, 12]);
  // Nachts zählt „nur nachts“ auch mit always.
  assert.deepEqual(coveredCameras({ ...base, always: true }).cameras, [3, 8, 9, 12]);
});

test("ohne Wächter, ohne Chat, ohne Bildmodell oder am Stundenlimit: keine Kamera", () => {
  assert.deepEqual(coveredCameras({ ...base, enabled: false }), { cameras: [], blocked: "Wächter aus", held: [] });
  assert.deepEqual(coveredCameras({ ...base, paired: false }), { cameras: [], blocked: "kein Chat gekoppelt", held: [] });
  // Kommen Alarme nicht an, meldet die Cloud selbst (deliveryTrouble).
  const trouble = "Telegram-Zustellung gestört: Alarm seit 1 min 5 s unterwegs";
  assert.deepEqual(coveredCameras({ ...base, delivery: trouble }), { cameras: [], blocked: trouble, held: [] });
  assert.deepEqual(coveredCameras({ ...base, visionReady: false }), { cameras: [], blocked: "Bildmodell nicht bereit", held: [] });
  assert.deepEqual(coveredCameras({ ...base, inspectionsLastHour: 30 }).cameras, []);
  assert.match(coveredCameras({ ...base, inspectionsLastHour: 30 }).blocked ?? "", /Stundenlimit/);
  assert.deepEqual(coveredCameras({ ...base, inspectionsLastHour: 29 }).cameras, [3, 8, 9]);
});

test("Bildmodell antwortet nicht: nur im Nachtfenster, dort geht der Alarm ungeprüft hinaus", () => {
  assert.deepEqual(coveredCameras({ ...base, visionFailStreak: 2 }).cameras, [3, 8, 9]);
  const day = coveredCameras({ ...base, visionFailStreak: 2, hour: 14 });
  assert.deepEqual(day, { cameras: [], blocked: "Bildmodell antwortet nicht", held: [] });
});

test("Stunde nicht lesbar: geschlossene Räume und „nur nachts“ bleiben bewacht, ohne Betriebszeit nicht", () => {
  assert.deepEqual(coveredCameras({ ...base, hour: Number.NaN }).cameras, [3, 9]);
  assert.deepEqual(coveredCameras({ ...base, hour: Number.NaN, visionFailStreak: 1 }).cameras, []);
});

test("inspectionsInLastHour zählt wie das Stundenlimit", () => {
  const now = 10 * HOUR_MS;
  assert.equal(inspectionsInLastHour([now - HOUR_MS - 1, now - HOUR_MS, now - 1000, now], now), 3);
});

test("coverageReport: Liste des letzten Takts, nach 30 s ohne Takt leer", () => {
  const at = Date.parse("2026-11-23T22:04:00.000Z");
  assert.deepEqual(coverageReport({ at, cameras: [8, 9] }, at + 5_000), { at: "2026-11-23T22:04:00.000Z", cameras: [8, 9] });
  assert.deepEqual(coverageReport({ at, cameras: [8, 9] }, at + COVER_TICK_MAX_AGE_MS + 1).cameras, []);
  assert.deepEqual(coverageReport(null, at), { at: "2026-11-23T22:04:00.000Z", cameras: [] });
  // Uhr springt zurueck: der Stand wirkt aus der Zukunft und gilt nicht.
  assert.deepEqual(coverageReport({ at, cameras: [8] }, at - COVER_TICK_MAX_AGE_MS - 1).cameras, []);
});

/* ------------------------------------------------ Beleg je Sichtung (vouchFor) */

test("vouchFor: Beleg nur mit freier Liste, frischem Takt, Kamera in der Liste und „bewertet“ oder „gemeldet“", () => {
  const at = Date.parse("2026-11-23T22:04:00.000Z");
  const ok: VouchInput = { hold: null, last: { at, cameras: [8, 9] }, now: at + 10_000, cameraId: 8, duty: "bewertet" };
  const rows: Array<[string, Partial<VouchInput>, boolean, boolean]> = [
    // Fall, Abweichung, Beleg, in der Liste
    ["Bewertung läuft", {}, true, true],
    ["Alarm gesendet", { duty: "gemeldet" }, true, true],
    ["bereit belegt nichts", { duty: "frei" }, false, true],
    ["Person ohne Bewertung", { duty: "offen" }, false, true],
    ["Auslöser wartet", { duty: "wartet" }, false, true],
    ["Sperrzeit", { duty: "gesperrt" }, false, true],
    ["kein Platz", { duty: "kein_platz" }, false, true],
    ["Liste gesperrt", { hold: "Neustart nach Update" }, false, false],
    ["noch kein Takt", { last: null }, false, false],
    ["Takt genau 30 s alt", { now: at + COVER_TICK_MAX_AGE_MS }, true, true],
    ["Takt älter als 30 s", { now: at + COVER_TICK_MAX_AGE_MS + 1 }, false, false],
    ["Takt weit in der Zukunft (Uhr zurück)", { now: at - COVER_TICK_MAX_AGE_MS - 1 }, false, false],
    ["Kamera nicht in der Liste", { cameraId: 12 }, false, false],
    ["leere Liste", { last: { at, cameras: [] } }, false, false],
  ];
  for (const [name, change, vouched, listed] of rows) {
    const v = vouchFor({ ...ok, ...change });
    assert.equal(v.ok, vouched, name);
    assert.equal(v.listed, listed, name);
  }
  assert.equal(vouchFor({ ...ok, hold: "Neustart nach Update" }).why, "Liste gesperrt: Neustart nach Update");
  assert.equal(vouchFor({ ...ok, duty: "frei" }).why, "keine Bewertung dieser Person (bereit)");
});

test("coverageShrank: nur wenn eine Kamera wegfällt", () => {
  assert.equal(coverageShrank([8, 9], [9]), true);
  assert.equal(coverageShrank([8, 9], []), true);
  assert.equal(coverageShrank([9], [8, 9]), false);
  assert.equal(coverageShrank([], []), false);
});

test("coverageLine: eine Zeile je Änderung, beim Start nur mit Kameras", () => {
  const names = new Map([
    [8, "Umkleide"],
    [9, "Eingang"],
  ]);
  assert.equal(coverageLine(null, { cameras: [], blocked: "Bildmodell nicht bereit", held: [] }, names), null);
  assert.match(coverageLine(null, { cameras: [8, 9], blocked: null, held: [] }, names) ?? "", /2 bewachte Kamera\(s\).*Umkleide, Eingang$/);
  assert.equal(coverageLine([8, 9], { cameras: [8, 9], blocked: null, held: [] }, names), null);
  assert.equal(
    coverageLine([8, 9], { cameras: [], blocked: "Bildmodell nicht bereit", held: [] }, names),
    "Wächter: Cloud meldet unbekannte Personen wieder an allen Kameras selbst (Bildmodell nicht bereit)"
  );
  assert.match(coverageLine([8], { cameras: [8, 12], blocked: null, held: [] }, names) ?? "", /Umkleide, #12$/);
  // Kameras, die wegen ihres Stands fehlen, stehen mit Grund in der Zeile.
  assert.equal(
    coverageLine([8, 9], { cameras: [9], blocked: null, held: [{ id: 8, duty: "offen" }] }, names),
    "Wächter: meldet der Cloud 1 bewachte Kamera(s) – unbekannte Personen dort nur noch über den Wächter: Eingang " +
      "(selbst meldet die Cloud an: Umkleide – Person ohne laufende Bewertung)"
  );
  assert.equal(
    coverageLine([8], { cameras: [], blocked: null, held: [{ id: 8, duty: "gesperrt" }] }, names),
    "Wächter: Cloud meldet unbekannte Personen wieder an allen Kameras selbst (Umkleide – Sperrzeit nach der letzten Bewertung)"
  );
});

/* ------------------------------------------------ Stand je Kamera (cameraDuty) */

test("cameraDuty: gemeldet wird nur, was der Wächter bewertet oder sofort bewerten würde", () => {
  const idle = { now: 10_000, personSince: null, lastPerson: null, locked: false, waiting: false, slotFree: true };
  assert.equal(cameraDuty(idle), "frei");
  assert.equal(cameraDuty({ ...idle, slotFree: false }), "kein_platz");
  assert.equal(cameraDuty({ ...idle, waiting: true }), "wartet");
  assert.equal(cameraDuty({ ...idle, locked: true }), "gesperrt");
  // Offenes Personen-Ereignis ohne Bewertung (kein Ausloeser, uebergangen, verfallen).
  assert.equal(cameraDuty({ ...idle, personSince: 1_000 }), "offen");
  // Die laufende Bewertung begann nach dem Beginn des Ereignisses: Sie gilt ihm.
  assert.equal(cameraDuty({ ...idle, personSince: 1_000, lastPerson: { at: 1_000, outcome: null }, locked: true }), "bewertet");
  // Eine laufende Bewertung eines frueheren Ereignisses deckt das neue nicht ab.
  assert.equal(cameraDuty({ ...idle, personSince: 2_000, lastPerson: { at: 1_000, outcome: null }, locked: true }), "offen");
  // Das Ereignis endete waehrend der Bewertung: Sie laeuft weiter und gilt.
  assert.equal(cameraDuty({ ...idle, lastPerson: { at: 1_000, outcome: null }, locked: true }), "bewertet");
  // Bewertung ohne Alarm beendet, die Person ist noch da: offen.
  for (const outcome of ["kein_alarm", "unauffaellig", "tracker_leer", "nahaufnahme_leer", "fehler"] as const) {
    assert.equal(cameraDuty({ ...idle, personSince: 1_000, lastPerson: { at: 1_000, outcome }, locked: true }), "offen", outcome);
  }
  // Mit Alarm: gemeldet, solange die Sperrzeit laeuft; danach offen.
  assert.equal(cameraDuty({ ...idle, personSince: 1_000, lastPerson: { at: 1_000, outcome: "alarm" }, locked: true }), "gemeldet");
  assert.equal(cameraDuty({ ...idle, personSince: 1_000, lastPerson: { at: 1_000, outcome: "alarm" }, locked: false }), "offen");
  // Nach dem Alarm ist die Person weg, die Sperrzeit laeuft: Ein neuer Ausloeser wuerde uebergangen.
  assert.equal(cameraDuty({ ...idle, lastPerson: { at: 1_000, outcome: "alarm" }, locked: true }), "gesperrt");
  const covers = (["bewertet", "gemeldet", "frei", "offen", "gesperrt", "wartet", "kein_platz"] as CameraDuty[]).filter(dutyCovers);
  assert.deepEqual(covers, ["bewertet", "gemeldet", "frei"]);
});

test("cameraDuty: eine Bewertung ohne Ergebnis gilt höchstens 5 min als laufend, danach offen", () => {
  const at = 1_800_000_000_000;
  const running = { personSince: at, lastPerson: { at, outcome: null }, locked: true, waiting: false, slotFree: true };
  assert.equal(cameraDuty({ ...running, now: at }), "bewertet");
  assert.equal(cameraDuty({ ...running, now: at + INSPECT_COVER_MAX_MS }), "bewertet", "genau 5 min");
  assert.equal(cameraDuty({ ...running, now: at + INSPECT_COVER_MAX_MS + 1 }), "offen");
  // Auch wenn das Personen-Ereignis schon endete: Eine haengende Bewertung belegt nichts.
  assert.equal(cameraDuty({ ...running, personSince: null, now: at + INSPECT_COVER_MAX_MS + 1 }), "offen");
  // Uhr zurueckgestellt: Der Beginn liegt nach jetzt.
  assert.equal(cameraDuty({ ...running, now: at - 1 }), "offen");
  assert.equal(INSPECT_COVER_MAX_MS, 5 * 60_000);
  // Mit Ergebnis zaehlt die Dauer nicht: Nach einem Alarm bleibt es waehrend der Sperrzeit bei „gemeldet“.
  assert.equal(cameraDuty({ ...running, lastPerson: { at, outcome: "alarm" }, now: at + INSPECT_COVER_MAX_MS + 1 }), "gemeldet");
});

test("coveredCameras: bewachte Kameras mit offenem Stand fehlen in der Liste und stehen unter held", () => {
  const c = coveredCameras({
    ...base,
    cams: [
      { id: 9, mode: "raum", roomClosed: true, duty: "offen" },
      { id: 8, mode: "raum", roomClosed: null, duty: "bewertet" },
      { id: 12, mode: "raum", roomClosed: false, duty: "offen" },
      { id: 3, mode: "nachts", roomClosed: false, duty: "gesperrt" },
    ],
  });
  // Kamera 12 ist nicht bewacht (Raum offen) und steht deshalb auch nicht unter held.
  assert.deepEqual(c, { cameras: [8], blocked: null, held: [{ id: 3, duty: "gesperrt" }, { id: 9, duty: "offen" }] });
});

/**
 * Nachstellung mit dem echten Takt (planTick, finishInspection): Stand der
 * Kamera so, wie sentinel.ts ihn aus Warteschlange und Personen-Ereignissen
 * bildet.
 */
function sim() {
  const q: SentinelQueue = newQueue(0);
  const personSince = new Map<number, number>();
  const lastPerson = new Map<number, { at: number; outcome: InspectOutcome | null }>();
  const NIGHT = "22-6";
  const tick = (now: number, triggers: number[] = []) => {
    for (const id of triggers) personSince.set(id, now);
    const plan = planTick(q, {
      now,
      hour: 23,
      nightWindow: NIGHT,
      maxPerHour: 30,
      maxBusy: 2,
      events: triggers.map((id) => ({ ev: { kind: "camera", title: "PERSON erkannt", where: `K${id}` }, camId: id, where: `K${id}`, closed: null, always: false })),
    });
    for (const s of plan.start) lastPerson.set(s.trigger.camId, { at: s.mark.at, outcome: null });
    return plan;
  };
  const duty = (id: number, now: number): CameraDuty => {
    const mark = q.marks.get(id);
    return cameraDuty({
      now,
      personSince: personSince.get(id) ?? null,
      lastPerson: lastPerson.get(id) ?? null,
      locked: mark !== undefined && now - mark.at < lockMs(mark, q.recent.length + q.early.length < 30),
      waiting: q.waiting.some((w) => w.camId === id),
      slotFree: q.busy < 2,
    });
  };
  const finish = (plan: ReturnType<typeof tick>, outcome: InspectOutcome) => {
    for (const s of plan.start) {
      finishInspection(q, s, outcome, 23, NIGHT);
      lastPerson.set(s.trigger.camId, { at: s.mark.at, outcome });
    }
  };
  const end = (id: number) => personSince.delete(id);
  return { q, tick, duty, finish, end };
}

test("Nachstellung: Sperrzeit nach „kein Alarm“ – eine zweite Person meldet die Cloud selbst", () => {
  const s = sim();
  const t0 = 1_800_000_000_000;
  const p = s.tick(t0, [1]);
  assert.equal(s.duty(1, t0), "bewertet");
  s.finish(p, "kein_alarm"); // z. B. starkes Gesicht eines Mitarbeiters
  // Die Person ist noch da: niemand bewertet, was die Kamera jetzt sieht.
  assert.equal(s.duty(1, t0 + 90_000), "offen");
  s.end(1);
  // Die Person ist weg, die Sperrzeit laeuft: Eine neue Person wuerde uebergangen.
  assert.equal(s.duty(1, t0 + 120_000), "gesperrt");
  const p2 = s.tick(t0 + 120_000, [1]);
  assert.equal(p2.skipped.abstand, 1);
  assert.equal(s.duty(1, t0 + 125_000), "offen");
  s.end(1);
  // Nach der Sperrzeit wieder bereit.
  assert.equal(s.duty(1, t0 + COOLDOWN_MS), "frei");
});

test("Nachstellung: Bewertung „unauffällig“, die Person bleibt ohne neuen Auslöser im Bild", () => {
  const s = sim();
  const t0 = 1_800_000_000_000;
  const p = s.tick(t0, [1]);
  s.finish(p, "unauffaellig");
  // Nachts 45 s Sperrzeit; danach kein neuer Ausloeser, solange das Ereignis andauert.
  assert.equal(s.duty(1, t0 + 39_000), "offen");
  assert.equal(s.duty(1, t0 + 69_000), "offen");
  s.end(1);
  assert.equal(s.duty(1, t0 + 69_000), "frei");
});

test("Nachstellung: beide Plätze belegt – dritte Kamera wartet, verfällt und fehlt in der Liste", () => {
  const s = sim();
  const t0 = 1_800_000_000_000;
  s.tick(t0, [1]);
  s.tick(t0 + 20_000, [2]);
  assert.equal(s.duty(3, t0 + 21_000), "kein_platz");
  const p3 = s.tick(t0 + 40_000, [3]);
  assert.equal(p3.start.length, 0);
  assert.equal(s.duty(3, t0 + 40_000), "offen");
  assert.equal(s.duty(1, t0 + 40_000), "bewertet");
  let expired = 0;
  for (let t = 43_000; t <= 72_000; t += 3_000) expired += s.tick(t0 + t).expired.length;
  assert.equal(expired, 1);
  assert.equal(s.duty(3, t0 + 75_000), "offen");
  s.end(3);
  assert.equal(s.duty(3, t0 + 75_000), "kein_platz");
});

test("Nachstellung: nach einem Alarm gilt die Person während der Sperrzeit als gemeldet", () => {
  const s = sim();
  const t0 = 1_800_000_000_000;
  const p = s.tick(t0, [1]);
  s.finish(p, "alarm");
  assert.equal(s.duty(1, t0 + 100_000), "gemeldet");
  // Nach der Sperrzeit ist die Person noch da: Die Cloud meldet dort wieder selbst.
  assert.equal(s.duty(1, t0 + COOLDOWN_MS), "offen");
});

test("Nachstellung: eine hängende Bewertung fällt nach 5 min aus der Liste", () => {
  const s = sim();
  const t0 = 1_800_000_000_000;
  s.tick(t0, [1]);
  assert.equal(s.duty(1, t0 + 60_000), "bewertet");
  assert.equal(s.duty(1, t0 + INSPECT_COVER_MAX_MS + 3_000), "offen");
  s.end(1);
  assert.equal(s.duty(1, t0 + INSPECT_COVER_MAX_MS + 3_000), "offen");
  assert.equal(dutyCovers(s.duty(1, t0 + INSPECT_COVER_MAX_MS + 3_000)), false);
});

test("cameraDuty: ein Alarm aus der Zukunft (Uhr zurückgestellt) belegt keine neue Person", () => {
  const at = 1_800_000_000_000;
  const after = { personSince: at - 3_600_000, lastPerson: { at, outcome: "alarm" as const }, locked: true, waiting: false, slotFree: true };
  assert.equal(cameraDuty({ ...after, now: at - 3_000_000 }), "offen");
  assert.equal(cameraDuty({ ...after, personSince: at, now: at }), "gemeldet");
});

test("HUB_SENTINEL_CLOUD_QUIET: ab Werk aus, nur 1, on, true, ja, yes schalten ein", () => {
  for (const raw of [undefined, "", "0", "off", "nein", "shadow", "an"]) assert.equal(cloudQuietOn(raw), false, String(raw));
  for (const raw of ["1", "on", "ON", "true", "ja", "yes", " on "]) assert.equal(cloudQuietOn(raw), true, raw);
});

test("vouchParam: sentinel=1 nur mit Schalter, Beleg und ohne Treffer der Gallery", () => {
  const ok = { ok: true, listed: true, why: "Bewertung läuft" };
  const listed = { ok: false, listed: true, why: "keine Bewertung dieser Person (bereit)" };
  const none = { ok: false, listed: false, why: "Kamera nicht in der Liste des Wächters" };
  const rows: Array<[string, Parameters<typeof vouchParam>[0], boolean, boolean, boolean, string]> = [
    ["an, Beleg", ok, true, false, true, "sighting_sentinel_beleg"],
    ["aus, Beleg", ok, false, false, false, "sighting_sentinel_beleg_aus"],
    ["an, Beleg, Treffer der Gallery", ok, true, true, false, "sighting_sentinel_treffer"],
    ["an, gelistet ohne Beleg", listed, true, false, false, "sighting_sentinel_gelistet_ohne_beleg"],
    ["an, nicht gelistet", none, true, false, false, "sighting_sentinel_ohne_beleg"],
  ];
  for (const [name, v, quietOn, galleryMatch, send, counter] of rows) {
    const r = vouchParam(v, { quietOn, galleryMatch });
    assert.equal(r.send, send, name);
    assert.equal(r.counter, counter, name);
  }
  assert.match(vouchParam(ok, { quietOn: false, galleryMatch: false }).note, /Cloud meldet selbst/);
});
