import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANNOUNCED_FIRES_MAX,
  FIRED_KEEP_MS,
  OUTAGE_AFTER_MS,
  OUTAGE_CONTACT_GAP_MS,
  OUTAGE_DEFAULT_CATCH_UP_MS,
  OUTAGE_RETRY_ATTEMPTS,
  OUTAGE_RETRY_GAP_MS,
  OutageRetries,
  SKIP_BEFORE_CONTACT,
  SKIP_CLOUD_ONLY,
  SKIP_EVENT_LATCHING_ONLY,
  SKIP_NEEDS_CLOUD,
  SKIP_NEVER_OPENS,
  SKIP_SUPERSEDED,
  announcedFires,
  dueInOutage,
  dueOutageTerms,
  failedRetryKeys,
  firedKey,
  hubRunRecord,
  laterTermDevices,
  missingAfter,
  nextOutageRetry,
  outageActionKey,
  outageActionStep,
  outageActive,
  outageDue,
  outageMotionReport,
  outageRetryDue,
  outageRetryStep,
  parseOutageStore,
  pruneFired,
  retryableStep,
  type HubRun,
  type OutageContext,
  type OutageDevice,
  type OutageRetry,
  type OutageTerm,
  type RunDetail,
} from "./outage-rules.js";

const T = Date.parse("2026-11-28T21:00:00.000Z");
const MIN = 60_000;

test("outageActive: erst nach der Karenz, ohne Kontakt ab dem Start", () => {
  assert.equal(outageActive(T, T - 10 * MIN, T + OUTAGE_AFTER_MS), false);
  assert.equal(outageActive(T, T - 10 * MIN, T + OUTAGE_AFTER_MS + 1), true);
  // Seit dem Start kein Kontakt: die Karenz laeuft ab dem Start.
  assert.equal(outageActive(null, T, T + 60_000), false);
  assert.equal(outageActive(null, T, T + OUTAGE_AFTER_MS + 1), true);
  // Eigene Karenz (HUB_RULES_OFFLINE_SEC).
  assert.equal(outageActive(T, T, T + 61_000, 60_000), true);
});

test("dueInOutage: Termin 30 s nach dem letzten Kontakt laeuft zu Beginn des Notbetriebs genau einmal", () => {
  const lastContact = T;
  const fireAt = T + 30_000;
  const outageStart = T + OUTAGE_AFTER_MS + 20_000; // erster Takt nach der Karenz
  // Vor dem Termin: nein.
  assert.equal(dueInOutage(fireAt, lastContact, fireAt - 1, false), false);
  // Zu Beginn des Notbetriebs (gut 3 Minuten spaeter): ja.
  assert.equal(dueInOutage(fireAt, lastContact, outageStart, false), true);
  // Mit Merker (auch nach einem Neustart aus hub/.cache gelesen): nein.
  assert.equal(dueInOutage(fireAt, lastContact, outageStart, true), false);
});

test("outageDue: nach dem letzten Kontakt jeder Termin, bis 6 Minuten davor nur in sicherer Richtung", () => {
  assert.equal(outageDue(T + 1, T, T + 4 * MIN, false), "after-contact");
  // Bis zum letzten Kontakt war die Cloud zustaendig; sie kann es noch nicht geschafft haben.
  assert.equal(outageDue(T, T, T + 4 * MIN, false), "before-contact");
  assert.equal(outageDue(T - MIN, T, T + 4 * MIN, false), "before-contact");
  assert.equal(outageDue(T - OUTAGE_CONTACT_GAP_MS + 1, T, T + 4 * MIN, false, T + 30 * MIN), "before-contact");
  // Davor: Die Cloud hatte ihren Cron-Lauf, der Hub fasst den Termin nicht an.
  assert.equal(outageDue(T - OUTAGE_CONTACT_GAP_MS, T, T + 4 * MIN, false, T + 30 * MIN), null);
  assert.equal(dueInOutage(T - OUTAGE_CONTACT_GAP_MS, T, T + 4 * MIN, false, T + 30 * MIN), false);
  // Merker und Nachholfrist gelten auch hier.
  assert.equal(outageDue(T - MIN, T, T + 4 * MIN, true, T + 29 * MIN), null);
  assert.equal(outageDue(T - MIN, T, T + 29 * MIN, false, T + 29 * MIN), null);
  assert.equal(dueInOutage(T - MIN, T, T + 4 * MIN, false), true);
  assert.equal(dueInOutage(T + 1, T, T + 4 * MIN, false), true);
});

test("outageActionStep: Termin kurz vor dem letzten Kontakt nur Aus und Zu", () => {
  const ctx = { timed: true, coverClose: true, beforeContact: true };
  // Rolltor zu: ja (ein zweites Zu schadet nicht).
  assert.deepEqual(outageActionStep(dev("close"), shelly("ROLLTOR"), ctx), { run: "cover-close" });
  assert.deepEqual(outageActionStep(dev("close"), shelly("ROLLTOR"), { ...ctx, coverClose: false }), { skip: SKIP_CLOUD_ONLY });
  // Licht, Schalter, Hue aus: ja; ein: nein.
  for (const d of [shelly("BELEUCHTUNG"), shelly("SCHALTER"), hue]) {
    for (const act of ["deactivate", "reset"]) assert.deepEqual(outageActionStep(dev(act), d, ctx), { run: "device" }, act);
    for (const act of ["open", "emergency"]) assert.deepEqual(outageActionStep(dev(act), d, ctx), { skip: SKIP_BEFORE_CONTACT }, act);
  }
  // Kamera-Szene: nein.
  assert.deepEqual(outageActionStep({ kind: "CAMERA", deviceId: null, deviceAction: null, targetCameraId: 3 }, null, ctx), {
    skip: SKIP_BEFORE_CONTACT,
  });
  // Was er auch sonst nicht schaltet, bleibt aus.
  for (const category of ["TUER", "DREHKREUZ", "TASTER", null]) {
    for (const act of ["open", "emergency", "deactivate"]) {
      assert.deepEqual(outageActionStep(dev(act), shelly(category), ctx), { skip: SKIP_NEVER_OPENS }, `${category} ${act}`);
    }
  }
  assert.deepEqual(outageActionStep({ kind: "NOTIFY", deviceId: null, deviceAction: null }, null, ctx), { skip: SKIP_NEEDS_CLOUD });
});

test("Netz faellt kurz nach dem Termin aus, bevor die Cloud schaltet: der Hub faehrt das Rolltor zu", () => {
  // Betriebsende 18:30:00, Rolltor zu. Cron der Cloud 18:30:41; Netz am Standort
  // weg ab 18:30:20, letzter gelungener Aufruf 18:30:18 (Task-Abruf alle 5 s).
  const fireAt = Date.parse("2026-11-28T17:30:00.000Z");
  const until = fireAt + 30 * MIN;
  const lastContact = fireAt + 18_000;
  const outageStart = lastContact + OUTAGE_AFTER_MS + 20_000;
  assert.equal(outageActive(lastContact, lastContact - MIN, outageStart), true);
  assert.equal(outageDue(fireAt, lastContact, outageStart, false, until), "before-contact");
  const step = outageActionStep(dev("close"), shelly("ROLLTOR"), { timed: true, coverClose: true, beforeContact: true });
  assert.deepEqual(step, { run: "cover-close" });
  // Noch in der Frist (Neustart, Takt verpasst): weiterhin; danach nicht mehr.
  assert.equal(outageDue(fireAt, lastContact, fireAt + 29 * MIN, false, until), "before-contact");
  assert.equal(outageDue(fireAt, lastContact, until, false, until), null);
  // Einmal ausgefuehrt: nicht noch einmal.
  assert.equal(outageDue(fireAt, lastContact, fireAt + 10 * MIN, true, until), null);
});

test("dueInOutage: Nachholfrist laut Plan, sonst 6 Minuten", () => {
  const fireAt = T + MIN;
  const until = fireAt + 30 * MIN;
  assert.equal(dueInOutage(fireAt, T, fireAt + 29 * MIN, false, until), true);
  assert.equal(dueInOutage(fireAt, T, until, false, until), false);
  // Aeltere Cloud ohne Frist im Plan.
  assert.equal(dueInOutage(fireAt, T, fireAt + OUTAGE_DEFAULT_CATCH_UP_MS - 1, false), true);
  assert.equal(dueInOutage(fireAt, T, fireAt + OUTAGE_DEFAULT_CATCH_UP_MS, false), false);
  // Unbrauchbare Frist: wie ohne.
  assert.equal(dueInOutage(fireAt, T, fireAt + 5 * MIN, false, fireAt - 1), true);
  assert.equal(dueInOutage(fireAt, T, fireAt + 10 * MIN, false, Number.NaN), false);
  assert.equal(dueInOutage(Number.NaN, T, T + MIN, false), false);
});

test("dueInOutage: Neustart im Notbetrieb holt nach, was seit dem letzten Kontakt faellig wurde", () => {
  // Kontakt um 21:00 (aus hub/.cache), Neustart 21:10, Termin 21:05 mit Frist 30 min.
  const fireAt = T + 5 * MIN;
  assert.equal(dueInOutage(fireAt, T, T + 13 * MIN, false, fireAt + 30 * MIN), true);
  // Schon vor dem Neustart ausgefuehrt: Merker aus der Datei.
  const store = parseOutageStore({ lastContactAt: T, fired: { [firedKey(7, new Date(fireAt).toISOString())]: fireAt } });
  const fired = firedKey(7, new Date(fireAt).toISOString()) in store.fired;
  assert.equal(dueInOutage(fireAt, store.lastContactAt ?? 0, T + 13 * MIN, fired, fireAt + 30 * MIN), false);
});

test("parseOutageStore: robust, nur Schluessel der Form <Regel>@<Termin>", () => {
  assert.deepEqual(parseOutageStore(null), { lastContactAt: null, fired: {} });
  assert.deepEqual(parseOutageStore([1, 2]), { lastContactAt: null, fired: {} });
  assert.deepEqual(parseOutageStore({ lastContactAt: "gestern", fired: "x" }), { lastContactAt: null, fired: {} });
  assert.deepEqual(
    parseOutageStore({ lastContactAt: T, fired: { "3@2026-11-28T21:00:00.000Z": T, kaputt: T, "4@x": "y" } }),
    { lastContactAt: T, fired: { "3@2026-11-28T21:00:00.000Z": T } },
  );
});

test("pruneFired: Termine aelter als 24 h fallen weg", () => {
  const fired = { "1@a": T - FIRED_KEEP_MS - 1, "2@b": T - FIRED_KEEP_MS, "3@c": T };
  assert.deepEqual(pruneFired(fired, T), { "2@b": T - FIRED_KEEP_MS, "3@c": T });
});

const shelly = (category: string | null, ip: string | null = "192.168.1.20"): OutageDevice => ({
  type: "SHELLY",
  category,
  ipAddress: ip,
});
const hue: OutageDevice = { type: "HUE_LIGHT", category: "BELEUCHTUNG", ipAddress: null, hueBridgeId: "b", hueLightId: "1" };
const dev = (deviceAction: string) => ({ kind: "DEVICE", deviceId: 5, deviceAction });
/** Kontext, mit dem rules.ts (`tick`) einen Termin aus dem Plan ausfuehrt. */
const inOutage = { timed: true };
const event = {};

test("outageActionStep: je Aktionsart, im Zweifel nein", () => {
  assert.deepEqual(outageActionStep({ kind: "CAMERA", deviceId: null, deviceAction: null, targetCameraId: 3 }, null, inOutage), {
    run: "camera",
  });
  assert.deepEqual(outageActionStep({ kind: "CAMERA", deviceId: null, deviceAction: null }, null, inOutage), {
    skip: "Kamera fehlt",
  });
  for (const kind of ["NOTIFY", "AUDIO", "PI", "UNBEKANNT"]) {
    assert.deepEqual(outageActionStep({ kind, deviceId: null, deviceAction: null }, null, inOutage), { skip: SKIP_NEEDS_CLOUD });
  }
  assert.deepEqual(outageActionStep({ kind: "DEVICE", deviceId: null, deviceAction: "open" }, null, inOutage), {
    skip: "Gerät oder Aktion fehlt",
  });
  assert.deepEqual(outageActionStep(dev("open"), null, inOutage), { skip: "Gerät unbekannt – Räume neu laden" });
  // Schalter, Licht, Hue: ein und aus.
  for (const act of ["open", "emergency", "deactivate", "reset"]) {
    assert.deepEqual(outageActionStep(dev(act), shelly("SCHALTER"), inOutage), { run: "device" }, act);
    assert.deepEqual(outageActionStep(dev(act), shelly("BELEUCHTUNG"), inOutage), { run: "device" }, act);
    assert.deepEqual(outageActionStep(dev(act), hue, inOutage), { run: "device" }, act);
  }
  // Zu, Stopp und unbekannte Befehle nur ueber die Cloud, ebenso ohne IP und andere Geraete.
  assert.deepEqual(outageActionStep(dev("close"), shelly("SCHALTER"), inOutage), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("stop"), shelly("SCHALTER"), inOutage), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("activate"), shelly("SCHALTER"), inOutage), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("close"), hue, inOutage), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("open"), shelly("SCHALTER", null), inOutage), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("open"), { type: "DOORBIRD", category: null, ipAddress: "192.168.1.9" }, inOutage), {
    skip: SKIP_CLOUD_ONLY,
  });
  // Antriebe: nie auf, nie Stopp.
  assert.deepEqual(outageActionStep(dev("open"), shelly("ROLLTOR"), inOutage), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("open"), shelly("MARKISE"), inOutage), { skip: SKIP_CLOUD_ONLY });
  // Tueroeffner, Drehkreuz, Taster, ohne Kategorie: nie, auch nicht aus.
  for (const category of ["TUER", "DREHKREUZ", "TASTER", null, "SENSOR"]) {
    for (const act of ["open", "emergency", "deactivate", "reset"]) {
      assert.deepEqual(outageActionStep(dev(act), shelly(category), inOutage), { skip: SKIP_NEVER_OPENS }, `${category} ${act}`);
    }
  }
});

test("outageActionStep: Termin in der Karenz oder nach Beginn des Notbetriebs, nie ein Impuls oder Dauer-Auf", () => {
  // Kontakt bis 21:00, Notbetrieb ab 21:03:20 (erster Takt nach der Karenz).
  const lastContact = T;
  const outageStart = T + OUTAGE_AFTER_MS + 20_000;
  const until = (fireAt: number) => fireAt + 30 * MIN;
  const cases = [
    { name: "Karenz", fireAt: T + 30_000, now: outageStart },
    { name: "nach Beginn", fireAt: outageStart + 2 * MIN, now: outageStart + 2 * MIN + 10_000 },
  ];
  for (const { name, fireAt, now } of cases) {
    assert.equal(dueInOutage(fireAt, lastContact, now, false, until(fireAt)), true, name);
    for (const coverClose of [true, false]) {
      for (const category of ["TUER", "DREHKREUZ", "TASTER", null]) {
        for (const act of ["open", "emergency"]) {
          const step = outageActionStep(dev(act), shelly(category), { timed: true, coverClose });
          assert.deepEqual(step, { skip: SKIP_NEVER_OPENS }, `${name} ${category} ${act}`);
        }
      }
      // Rolltor: auf und Dauer-Auf nie, auch nicht mit dem Schalter.
      for (const act of ["open", "emergency"]) {
        assert.deepEqual(outageActionStep(dev(act), shelly("ROLLTOR"), { timed: true, coverClose }), { skip: SKIP_CLOUD_ONLY }, `${name} ROLLTOR ${act}`);
      }
    }
  }
});

test("outageActionStep: auf ein Ereignis hin nur Licht, Schalter, Hue und Kamera-Szene", () => {
  for (const ctx of [event, { timed: false }]) {
    // Licht und Schalter ein und aus, auch ohne Zeitschalter; Hue; Kamera-Szene.
    for (const act of ["open", "emergency", "deactivate", "reset"]) {
      assert.deepEqual(outageActionStep(dev(act), shelly("BELEUCHTUNG"), ctx), { run: "device" }, act);
      assert.deepEqual(outageActionStep(dev(act), shelly("SCHALTER"), ctx), { run: "device" }, act);
    }
    // Kein gueltiger Befehl: nicht schalten.
    assert.deepEqual(outageActionStep(dev("activate"), shelly("BELEUCHTUNG"), ctx), { skip: SKIP_CLOUD_ONLY });
    assert.deepEqual(outageActionStep(dev("open"), hue, ctx), { run: "device" });
    assert.deepEqual(outageActionStep({ kind: "CAMERA", deviceId: null, deviceAction: null, targetCameraId: 3 }, null, ctx), {
      run: "camera",
    });
    // Tueroeffner, Drehkreuz, Taster, Shelly ohne Kategorie und andere Arten: nie.
    for (const category of ["TUER", "DREHKREUZ", "TASTER", null, "SENSOR", "AUDIO"]) {
      for (const act of ["open", "emergency", "deactivate", "reset"]) {
        assert.deepEqual(outageActionStep(dev(act), shelly(category), ctx), { skip: SKIP_EVENT_LATCHING_ONLY }, `${category} ${act}`);
      }
    }
    // Antriebe, DoorBird und Geraete ohne IP: wie bisher nur ueber die Cloud.
    for (const d of [shelly("ROLLTOR"), shelly("MARKISE"), shelly("SCHALTER", null), { type: "DOORBIRD", category: null, ipAddress: "192.168.1.9" }]) {
      assert.deepEqual(outageActionStep(dev("open"), d, ctx), { skip: SKIP_CLOUD_ONLY });
    }
    assert.deepEqual(outageActionStep(dev("close"), shelly("ROLLTOR"), { ...ctx, coverClose: true }), { skip: SKIP_CLOUD_ONLY });
  }
  // Auch zu einem Termin: kein Impuls an der Tuer.
  assert.deepEqual(outageActionStep(dev("open"), shelly("TUER"), inOutage), { skip: SKIP_NEVER_OPENS });
});

test("hubRunRecord: Erfolg nur, wenn jede Aktion gelang", () => {
  const ok = hubRunRecord({
    ruleId: 4,
    triggerKind: "closing",
    startedAt: T,
    finishedAt: T + 800,
    fireAt: "2026-11-28T20:58:00.000Z",
    details: [{ actionId: 1, key: "a1", kind: "DEVICE", target: "Licht", ok: true, ms: 120 }],
  });
  assert.equal(ok.success, true);
  assert.equal(ok.errorMessage, null);
  assert.equal(ok.at, "2026-11-28T21:00:00.000Z");
  assert.equal(ok.finishedAt, "2026-11-28T21:00:00.800Z");
  assert.equal(ok.eventAt, "2026-11-28T20:58:00.000Z");

  const partial = hubRunRecord({
    ruleId: 4,
    triggerKind: "closing",
    startedAt: T,
    details: [
      { actionId: 1, kind: "DEVICE", target: "Licht", ok: true },
      { actionId: 2, kind: "NOTIFY", target: "NOTIFY", ok: false, error: SKIP_NEEDS_CLOUD },
    ],
  });
  assert.equal(partial.success, false);
  assert.equal(partial.errorMessage, `NOTIFY: ${SKIP_NEEDS_CLOUD}`);
  assert.equal(partial.fireAt, undefined);
  assert.equal(partial.eventAt, undefined);

  // Ohne Aktionen: kein Erfolg.
  assert.equal(hubRunRecord({ ruleId: 4, triggerKind: "time", startedAt: T, details: [] }).success, false);
});

test("outageActionStep: Rolltor nur zu, nur bei Zeit-Regeln und nur mit Schalter", () => {
  const timed = { timed: true, coverClose: true };
  const gate = shelly("ROLLTOR");
  assert.deepEqual(outageActionStep(dev("close"), gate, timed), { run: "cover-close" });
  // Auf und Stopp bleiben der Cloud vorbehalten.
  assert.deepEqual(outageActionStep(dev("open"), gate, timed), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("stop"), gate, timed), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("emergency"), gate, timed), { skip: SKIP_CLOUD_ONLY });
  // Bewegung, Schaltvorgang, Ruhe: nein.
  assert.deepEqual(outageActionStep(dev("close"), gate, { ...timed, timed: false }), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("open"), gate, event), { skip: SKIP_CLOUD_ONLY });
  // Schalter aus (HUB_EMERGENCY_COVER_CLOSE=0): wie bisher.
  assert.deepEqual(outageActionStep(dev("close"), gate, { ...timed, coverClose: false }), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("close"), gate, {}), { skip: SKIP_CLOUD_ONLY });
  // Markise, Rolltor ohne IP, anderes Geraet: nein.
  assert.deepEqual(outageActionStep(dev("close"), shelly("MARKISE"), timed), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("close"), shelly("ROLLTOR", null), timed), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("close"), shelly("ROLLTOR", "tor.local"), timed), { skip: SKIP_CLOUD_ONLY });
  assert.deepEqual(outageActionStep(dev("close"), { type: "PI", category: "ROLLTOR", ipAddress: "192.168.1.7" }, timed), {
    skip: SKIP_CLOUD_ONLY,
  });
  assert.deepEqual(outageActionStep(dev("close"), shelly("TUER"), timed), { skip: SKIP_CLOUD_ONLY });
});

test("announcedFires: ausstehende Termine fuer das Lebenszeichen, juengste zuerst, ohne Bewegung", () => {
  const fires = announcedFires([
    { ruleId: 1, fireAt: "2026-11-28T21:00:00.000Z" },
    { ruleId: 2 },
    { ruleId: 1, fireAt: "2026-11-28T21:00:00.000Z" },
    { ruleId: 3, fireAt: "2026-11-28T22:00:00.000Z" },
    { ruleId: 4, fireAt: "kaputt" },
  ]);
  assert.deepEqual(fires, [
    { ruleId: 3, fireAt: "2026-11-28T22:00:00.000Z" },
    { ruleId: 1, fireAt: "2026-11-28T21:00:00.000Z" },
  ]);
  assert.deepEqual(announcedFires([]), []);
  const many = Array.from({ length: 250 }, (_, i) => ({ ruleId: i + 1, fireAt: new Date(T + i * MIN).toISOString() }));
  const capped = announcedFires(many);
  assert.equal(capped.length, ANNOUNCED_FIRES_MAX);
  assert.equal(capped[0].ruleId, 250);
});

test("outageMotionReport: Bewegung im Notbetrieb nennt der Hub mit dem Ereignis, wenn alles gelang und die Regel ihm gehoert", () => {
  const rule = { id: 31, hubConfigAt: "2026-11-20T09:15:00.000Z" };
  const details = [
    { actionId: 1, key: "DEVICE:7:open", kind: "DEVICE", target: "Licht Halle", ok: true },
    { actionId: 2, key: "CAMERA:3:1:-", kind: "CAMERA", target: "Kamera #3", ok: true },
  ];
  const ok = hubRunRecord({ ruleId: 31, triggerKind: "motion", startedAt: T, details });
  assert.deepEqual(outageMotionReport(rule, ok), { ruleId: 31, configAt: "2026-11-20T09:15:00.000Z" });
  // Eine Aktion gescheitert: Die Cloud fuehrt die Regel aus, wenn die Meldung ankommt.
  const partial = hubRunRecord({ ruleId: 31, triggerKind: "motion", startedAt: T, details: [details[0], { ...details[1], ok: false, error: "Zeitüberschreitung" }] });
  assert.equal(outageMotionReport(rule, partial), null);
  // Laut Plan nicht dem Hub zugeschrieben (kein Stand, etwa mit Benachrichtigung): nie nennen.
  assert.equal(outageMotionReport({ id: 31 }, ok), null);
});

test("retryableStep: nur Aus an Licht, Schalter, Hue und Zu am Rolltor, nie Ein oder Kamera-Szene", () => {
  const cover = { timed: true, coverClose: true };
  const step = (a: ReturnType<typeof dev>, d: OutageDevice | null, ctx: object = inOutage) => retryableStep(a, outageActionStep(a, d, ctx));
  for (const act of ["deactivate", "reset"]) {
    assert.equal(step(dev(act), shelly("BELEUCHTUNG")), true, act);
    assert.equal(step(dev(act), shelly("SCHALTER")), true, act);
    assert.equal(step(dev(act), hue), true, act);
  }
  for (const act of ["open", "emergency"]) {
    assert.equal(step(dev(act), shelly("BELEUCHTUNG")), false, act);
    assert.equal(step(dev(act), hue), false, act);
  }
  assert.equal(step(dev("close"), shelly("ROLLTOR"), cover), true);
  // Ohne HUB_EMERGENCY_COVER_CLOSE schliesst der Hub gar nicht, also auch kein zweiter Versuch.
  assert.equal(step(dev("close"), shelly("ROLLTOR"), inOutage), false);
  const scene = { kind: "CAMERA", deviceId: null, deviceAction: null, targetCameraId: 3 };
  assert.equal(retryableStep(scene, outageActionStep(scene, null, inOutage)), false);
  // Uebersprungen (Cloud, nie oeffnen): kein Fehler im LAN, nichts zu wiederholen.
  assert.equal(step(dev("deactivate"), shelly("TUER")), false);
  const notify = { kind: "NOTIFY", deviceId: null, deviceAction: null };
  assert.equal(retryableStep(notify, outageActionStep(notify, null, inOutage)), false);
});

test("Wiederholung im Notbetrieb: nach drei Versuchen Schluss, kein Versuch nach der Frist", () => {
  const until = T + 6 * MIN;
  const missing = ["DEVICE:9:close", "NOTIFY:PUSH"];
  let retry = nextOutageRetry(null, ["DEVICE:9:close"], T, until, missing);
  assert.deepEqual(retry, { keys: ["DEVICE:9:close"], missing, attempts: 1, lastAt: T, until });
  assert.equal(outageRetryDue(retry as OutageRetry, T + OUTAGE_RETRY_GAP_MS - 1), false);
  assert.equal(outageRetryDue(retry as OutageRetry, T + OUTAGE_RETRY_GAP_MS), true);
  retry = nextOutageRetry(retry, ["DEVICE:9:close"], T + OUTAGE_RETRY_GAP_MS, until, missing);
  assert.equal(retry?.attempts, 2);
  // Dritter Versuch gescheitert: keine weiteren.
  assert.equal(nextOutageRetry(retry, ["DEVICE:9:close"], T + 2 * OUTAGE_RETRY_GAP_MS, until, missing), null);
  // Kein weiterer Versuch passt mehr in die Frist.
  assert.equal(nextOutageRetry(null, ["DEVICE:9:close"], until - OUTAGE_RETRY_GAP_MS, until, missing), null);
  assert.equal(outageRetryDue({ keys: ["x"], missing: ["x"], attempts: 1, lastAt: T, until }, until), false);
  // Alles gelungen: nichts mehr; eine Wiederholung nimmt nur, was noch fehlte.
  assert.equal(nextOutageRetry(null, [], T, until, []), null);
  const prev = { keys: ["a"], missing: ["a"], attempts: 1, lastAt: T, until: T + 30 * MIN };
  assert.deepEqual(nextOutageRetry(prev, ["a", "b"], T + MIN, T + 30 * MIN, ["a"])?.keys, ["a"]);
});

/* Spaeterer Termin am selben Geraet: Uhrzeiten in Ortszeit (T ist 22:00). */
const at = (ms: number) => new Date(ms).toISOString();
type TestAction = { id: number; key: string; kind: string; deviceId: number | null; deviceAction: string | null };
const planRule = (id: number, fires: number[], actions: TestAction[]) => ({
  id,
  fireAt: fires.map(at),
  fireUntil: fires.map((t) => at(t + 30 * MIN)),
  actions,
});
const lightOff: TestAction = { id: 11, key: "DEVICE:5:deactivate", kind: "DEVICE", deviceId: 5, deviceAction: "deactivate" };
const lightOn: TestAction = { id: 21, key: "DEVICE:5:open", kind: "DEVICE", deviceId: 5, deviceAction: "open" };
const gateClose: TestAction = { id: 12, key: "DEVICE:9:close", kind: "DEVICE", deviceId: 9, deviceAction: "close" };
const hall = new Map<number, OutageDevice>([
  [5, shelly("BELEUCHTUNG", "192.168.1.20")],
  [9, shelly("ROLLTOR", "192.168.1.40")],
]);
const termOpts = (lastContact: number, now: number, fired: Record<string, number> = {}) => ({
  lastContact,
  now,
  fired,
  coverClose: true,
  device: (id: number) => hall.get(id) ?? null,
});
type TestRule = ReturnType<typeof planRule>;
type RetryEntry = { ruleId: number; at: string; ctx: OutageContext; retry: OutageRetry };

/**
 * Notbetrieb wie rules.ts (`tick` mit `noteRetry` und `runRetries`), jede
 * Entscheidung aus outage-rules.ts. Nachgebaut ist nur das LAN: `lan` nennt
 * je Aktion die Antworten der Reihe nach (sonst gelingt sie); `state` haelt,
 * was zuletzt an jedem Geraet geschaltet wurde.
 */
function outageHub(rules: TestRule[], lastContact: number, lan: Record<string, boolean[]> = {}, devices = hall) {
  const fired: Record<string, number> = {};
  const retries = new OutageRetries<RetryEntry>();
  const runs: HubRun[] = [];
  const calls: Array<{ at: number; key: string }> = [];
  const state = new Map<number, string>();
  const device = (id: number) => devices.get(id) ?? null;
  const stepFor = (ctx: OutageContext) => (a: TestAction) => outageActionStep(a, a.deviceId ? device(a.deviceId) : null, ctx);
  // rules.ts `executeLocal`.
  type Retry = { only: ReadonlySet<string>; missing: readonly string[] };
  const execute = (now: number, rule: TestRule, fireAt: string, ctx: OutageContext, retry?: Retry) => {
    const details: RunDetail[] = [];
    for (const a of rule.actions) {
      if (retry && !retry.only.has(outageActionKey(a))) continue;
      const step = stepFor(ctx)(a);
      const base = { actionId: a.id, key: a.key, kind: a.kind, target: a.key };
      if ("skip" in step) {
        details.push({ ...base, ok: false, error: step.skip });
        continue;
      }
      const ok = lan[a.key]?.[calls.filter((c) => c.key === a.key).length] ?? true;
      calls.push({ at: now, key: a.key });
      if (ok && a.deviceId) state.set(a.deviceId, a.deviceAction ?? "");
      details.push({ ...base, ok, ...(ok ? {} : { error: "Zeitüberschreitung" }) });
    }
    const run = hubRunRecord({ ruleId: rule.id, triggerKind: "time", startedAt: now, fireAt, details, retry });
    runs.push(run);
    return run;
  };
  // rules.ts `noteRetry`.
  const note = (term: Pick<OutageTerm<TestRule>, "key" | "rule" | "at" | "ctx" | "until">, run: HubRun, prev: OutageRetry | null, gen: number) => {
    const failed = failedRetryKeys(term.rule.actions, run.details, stepFor(term.ctx));
    const missing = missingAfter(term.rule.actions, prev?.missing ?? null, run.details);
    const next = nextOutageRetry(prev, failed, Date.parse(run.at), term.until, missing);
    retries.note(term.key, next ? { ruleId: term.rule.id, at: term.at, ctx: term.ctx, retry: next } : null, gen);
  };
  return {
    runs,
    calls,
    state,
    retries,
    /** Ein Takt im Notbetrieb zur Zeit `now`; Ergebnis: die Termine, die er ausfuehrt. */
    tick(now: number) {
      const gen = retries.generation;
      const terms = dueOutageTerms(rules, { lastContact, now, fired, coverClose: true, device });
      for (const term of terms) {
        if (term.key in fired) continue;
        fired[term.key] = term.fireAt;
        note(term, execute(now, term.rule, term.at, term.ctx), null, gen);
      }
      // rules.ts `runRetries`.
      for (const [key, entry] of retries.list()) {
        const rule = rules.find((r) => r.id === entry.ruleId) ?? null;
        const ctx: OutageContext = { ...entry.ctx, laterTerm: laterTermDevices(rules, Date.parse(entry.at), now) };
        const step = outageRetryStep(entry.retry, rule?.actions ?? null, now, stepFor(ctx));
        if ("wait" in step) continue;
        retries.delete(key);
        if ("drop" in step || !rule) continue;
        const run = execute(now, rule, entry.at, ctx, { only: new Set(step.run), missing: entry.retry.missing });
        note({ key, rule, at: entry.at, ctx, until: entry.retry.until }, run, { ...entry.retry, keys: step.run }, gen);
      }
      return terms;
    },
  };
}

test("laterTermDevices: Geraete eines spaeteren Termins bis jetzt, gleich welcher Regel", () => {
  const notify: TestAction = { id: 22, key: "NOTIFY:PUSH", kind: "NOTIFY", deviceId: null, deviceAction: null };
  const rules = [planRule(1, [T], [lightOff, gateClose]), planRule(2, [T + 5 * MIN], [lightOn, notify])];
  assert.deepEqual([...laterTermDevices(rules, T, T + 9 * MIN)], [5]);
  // Spaeterer Termin noch nicht erreicht oder gleichzeitig: zaehlt nicht.
  assert.deepEqual([...laterTermDevices(rules, T, T + 5 * MIN - 1)], []);
  assert.deepEqual([...laterTermDevices(rules, T + 5 * MIN, T + 9 * MIN)], []);
  // Auch dieselbe Regel mit einem spaeteren Termin.
  assert.deepEqual([...laterTermDevices([planRule(1, [T, T + 2 * MIN], [lightOff])], T, T + 3 * MIN)], [5]);
});

test("Notbetrieb: Aus 22:00 kurz vor dem Kontakt holt der Hub nicht nach, wenn 22:05 dasselbe Licht einschaltet", () => {
  // Regel A Licht aus 22:00, Regel B Licht an 22:05; die Cloud hat beide geschaltet.
  // Letzter Kontakt 22:05:50, Notbetrieb ab 22:08:50, erster Takt 22:09:00. Im Plan steht B vor A.
  const rules = [planRule(2, [T + 5 * MIN], [lightOn]), planRule(1, [T], [lightOff])];
  const lastContact = T + 5 * MIN + 50_000;
  const now = T + 9 * MIN;
  assert.equal(outageDue(T, lastContact, now, false, T + 30 * MIN), "before-contact");
  const hub = outageHub(rules, lastContact);
  hub.state.set(5, "open");
  // Kein Lauf: A ist ueberholt, B (Ein) holt der Hub vor dem Kontakt nie nach; auch nicht in den Takten danach.
  assert.deepEqual(hub.tick(now), []);
  for (let t = now + 20_000; t < T + 40 * MIN; t += 20_000) hub.tick(t);
  assert.deepEqual(hub.runs, []);
  assert.equal(hub.state.get(5), "open");
  const ctx = { timed: true, coverClose: true, beforeContact: true, laterTerm: laterTermDevices(rules, T, now) };
  assert.deepEqual(outageActionStep(lightOff, hall.get(5) ?? null, ctx), { skip: SKIP_SUPERSEDED });
  // Ohne spaeteren Termin am Licht: Das Aus holt er nach wie bisher.
  const alone = outageHub([planRule(1, [T], [lightOff])], lastContact);
  assert.deepEqual(alone.tick(now).map((t) => t.key), [firedKey(1, at(T))]);
  assert.equal(alone.state.get(5), "deactivate");
});

test("Notbetrieb: Ueberholt ist nur das Geraet des spaeteren Termins, das Rolltor schliesst der Hub trotzdem", () => {
  const rules = [planRule(1, [T], [lightOff, gateClose]), planRule(2, [T + 5 * MIN], [lightOn])];
  const lastContact = T + 5 * MIN + 50_000;
  const now = T + 9 * MIN;
  const hub = outageHub(rules, lastContact);
  hub.state.set(5, "open");
  hub.state.set(9, "open");
  const [term, ...rest] = hub.tick(now);
  assert.equal(rest.length, 0);
  assert.equal(term.rule.id, 1);
  assert.equal(hub.state.get(9), "close");
  assert.equal(hub.state.get(5), "open");
  assert.deepEqual(hub.runs[0].details.map((d) => [d.key, d.ok, d.error ?? null]), [
    ["DEVICE:5:deactivate", false, SKIP_SUPERSEDED],
    ["DEVICE:9:close", true, null],
  ]);
  // Das ueberholte Licht ist nicht wiederholbar, das Rolltor gelang: nichts vorgemerkt.
  assert.deepEqual(hub.retries.list(), []);
});

test("Notbetrieb: Termine eines Takts der Zeit nach, gleich wie die Regeln im Plan stehen", () => {
  // Kontakt bis 21:58, Notbetrieb ab 22:01:20; im ersten Takt um 22:06 sind A (aus 22:00) und B (an 22:05) faellig.
  const rules = [planRule(2, [T + 5 * MIN], [lightOn]), planRule(1, [T], [lightOff])];
  const hub = outageHub(rules, T - 2 * MIN);
  const terms = hub.tick(T + 6 * MIN);
  assert.deepEqual(terms.map((t) => t.rule.id), [1, 2]);
  assert.deepEqual(terms.map((t) => t.ctx.beforeContact), [false, false]);
  // Am Ende gilt der juengere Termin.
  assert.deepEqual(hub.calls.map((c) => c.key), ["DEVICE:5:deactivate", "DEVICE:5:open"]);
  assert.equal(hub.state.get(5), "open");
  // Gleicher Termin: Reihenfolge des Plans.
  const same = dueOutageTerms([planRule(3, [T], [lightOn]), planRule(4, [T], [lightOff])], termOpts(T - 2 * MIN, T + MIN));
  assert.deepEqual(same.map((t) => t.rule.id), [3, 4]);
  // Schon ausgefuehrt (Merker): nicht noch einmal.
  const done = dueOutageTerms(rules, termOpts(T - 2 * MIN, T + 6 * MIN, { [firedKey(1, at(T))]: T }));
  assert.deepEqual(done.map((t) => t.rule.id), [2]);
});

test("Wiederholung im Notbetrieb: kein zweites Aus, wenn inzwischen ein spaeterer Termin dasselbe Licht eingeschaltet hat", () => {
  // A Licht aus 22:00 und Rolltor zu; Kontakt bis 21:59. Erster Lauf 22:03:20: beides scheitert.
  // B Licht an 22:03:40 laeuft im naechsten Takt. Die Wiederholung von A ab 22:04:20 schaltet nur noch das Rolltor.
  const rules = [planRule(1, [T], [lightOff, gateClose]), planRule(2, [T + 3 * MIN + 40_000], [lightOn])];
  const first = T + 3 * MIN + 20_000;
  const [term] = dueOutageTerms(rules, termOpts(T - MIN, first));
  assert.equal(term.rule.id, 1);
  const stepOf = (ctx: object) => (a: TestAction) => outageActionStep(a, a.deviceId ? hall.get(a.deviceId) ?? null : null, ctx);
  const details = [{ actionId: 11, ok: false }, { actionId: 12, ok: false }];
  const failed = failedRetryKeys(term.rule.actions, details, stepOf(term.ctx));
  const retry = nextOutageRetry(null, failed, first, term.until, missingAfter(term.rule.actions, null, details)) as OutageRetry;
  assert.deepEqual(retry.keys, ["DEVICE:5:deactivate", "DEVICE:9:close"]);
  // Vor B: beides noch einmal.
  const early = T + 3 * MIN + 30_000;
  const before = stepOf({ ...term.ctx, laterTerm: laterTermDevices(rules, T, early) });
  assert.deepEqual(outageRetryStep({ ...retry, lastAt: early - OUTAGE_RETRY_GAP_MS }, term.rule.actions, early, before), {
    run: ["DEVICE:5:deactivate", "DEVICE:9:close"],
    skipped: [],
  });
  // Nach B: das Licht entfaellt.
  const now = first + OUTAGE_RETRY_GAP_MS;
  const ctx = { ...term.ctx, laterTerm: laterTermDevices(rules, T, now) };
  assert.deepEqual(outageRetryStep(retry, term.rule.actions, now, stepOf(ctx)), {
    run: ["DEVICE:9:close"],
    skipped: [{ key: "DEVICE:5:deactivate", reason: SKIP_SUPERSEDED }],
  });
  // Nur das Licht offen: keine Wiederholung mehr.
  assert.deepEqual(outageRetryStep({ ...retry, keys: ["DEVICE:5:deactivate"] }, term.rule.actions, now, stepOf(ctx)), {
    drop: SKIP_SUPERSEDED,
  });
});

test("outageRetryStep: Abstand, Frist, Regel und Aktion nicht mehr im Plan", () => {
  const actions = [gateClose];
  const retry: OutageRetry = { keys: ["DEVICE:9:close"], missing: ["DEVICE:9:close"], attempts: 1, lastAt: T, until: T + 30 * MIN };
  const stepOf = (a: TestAction) => outageActionStep(a, a.deviceId ? hall.get(a.deviceId) ?? null : null, { timed: true, coverClose: true });
  assert.deepEqual(outageRetryStep(retry, actions, T + OUTAGE_RETRY_GAP_MS - 1, stepOf), { wait: true });
  assert.deepEqual(outageRetryStep(retry, actions, T + OUTAGE_RETRY_GAP_MS, stepOf), { run: ["DEVICE:9:close"], skipped: [] });
  assert.deepEqual(outageRetryStep(retry, actions, T + 30 * MIN, stepOf), { drop: "Nachholfrist vorbei" });
  assert.deepEqual(outageRetryStep(retry, null, T + OUTAGE_RETRY_GAP_MS, stepOf), { drop: "Regel nicht mehr im Plan" });
  assert.deepEqual(outageRetryStep(retry, [lightOff], T + OUTAGE_RETRY_GAP_MS, stepOf), { drop: "Aktion nicht mehr im Plan" });
  // Schalter HUB_EMERGENCY_COVER_CLOSE inzwischen aus: nicht mehr wiederholbar.
  const off = (a: TestAction) => outageActionStep(a, hall.get(9) ?? null, { timed: true, coverClose: false });
  assert.deepEqual(outageRetryStep(retry, actions, T + OUTAGE_RETRY_GAP_MS, off), { drop: SKIP_CLOUD_ONLY });
});

test("hubRunRecord: Wiederholung ist erst Erfolg, wenn dem Termin ueber alle Laeufe des Hubs nichts mehr fehlt", () => {
  // Rolltor zu und Benachrichtigung; der erste Lauf scheitert am Rolltor, die Benachrichtigung braucht die Cloud.
  const actions = [
    { id: 1, key: "DEVICE:9:close", kind: "DEVICE", deviceId: 9, deviceAction: "close" },
    { id: 2, key: "NOTIFY:PUSH", kind: "NOTIFY", deviceId: null, deviceAction: null },
  ];
  const stepOf = (a: (typeof actions)[number]) =>
    outageActionStep(a, a.deviceId ? hall.get(a.deviceId) ?? null : null, { timed: true, coverClose: true });
  const firstDetails = [
    { actionId: 1, key: "DEVICE:9:close", kind: "DEVICE", target: "Rolltor", ok: false, error: "Status nicht lesbar" },
    { actionId: 2, key: "NOTIFY:PUSH", kind: "NOTIFY", target: "NOTIFY", ok: false, error: SKIP_NEEDS_CLOUD },
  ];
  const first = hubRunRecord({ ruleId: 4, triggerKind: "closing", startedAt: T, fireAt: at(T), details: firstDetails });
  assert.equal(first.success, false);
  const missing = missingAfter(actions, null, firstDetails);
  assert.deepEqual(missing, ["DEVICE:9:close", "NOTIFY:PUSH"]);
  const retry = nextOutageRetry(null, failedRetryKeys(actions, firstDetails, stepOf), T, T + 30 * MIN, missing) as OutageRetry;
  assert.deepEqual(retry.keys, ["DEVICE:9:close"]);
  // Wiederholung nur mit dem Rolltor: gelingt, ist aber kein Erfolg, weil die Benachrichtigung fehlt.
  const again = [{ actionId: 1, key: "DEVICE:9:close", kind: "DEVICE", target: "Rolltor", ok: true }];
  const second = hubRunRecord({
    ruleId: 4,
    triggerKind: "closing",
    startedAt: T + MIN,
    fireAt: at(T),
    details: again,
    retry: { only: new Set(retry.keys), missing: retry.missing },
  });
  assert.equal(second.success, false);
  assert.deepEqual(second.details, again);
  assert.equal(second.errorMessage, "Noch offen aus diesem Termin: 1 Aktion");
  assert.deepEqual(missingAfter(actions, retry.missing, again), ["NOTIFY:PUSH"]);
  assert.equal(nextOutageRetry(retry, failedRetryKeys(actions, again, stepOf), T + MIN, T + 30 * MIN, ["NOTIFY:PUSH"]), null);

  // Fehlte nur, was die Wiederholung schaltet: Erfolg wie bisher.
  const onlyGate = hubRunRecord({
    ruleId: 4,
    triggerKind: "closing",
    startedAt: T + MIN,
    fireAt: at(T),
    details: again,
    retry: { only: new Set(["DEVICE:9:close"]), missing: ["DEVICE:9:close"] },
  });
  assert.equal(onlyGate.success, true);
  assert.equal(onlyGate.errorMessage, null);
  // Entfaellt eine Aktion (spaeterer Termin am selben Geraet), fehlt sie weiter.
  const dropped = hubRunRecord({
    ruleId: 4,
    triggerKind: "closing",
    startedAt: T + MIN,
    details: [{ ...again[0], ok: false, error: "Zeitüberschreitung" }],
    retry: { only: new Set(["DEVICE:9:close"]), missing: ["DEVICE:9:close", "DEVICE:5:deactivate", "NOTIFY:PUSH"] },
  });
  assert.equal(dropped.success, false);
  assert.equal(dropped.errorMessage, "Rolltor: Zeitüberschreitung; Noch offen aus diesem Termin: 2 Aktionen");
});

test("OutageRetries: Kehrt die Cloud waehrend eines Laufs zurueck, merkt der Lauf danach nichts mehr vor", () => {
  const retries = new OutageRetries<string>();
  const gen = retries.generation;
  retries.note("1@a", "erster Versuch gescheitert", gen);
  assert.deepEqual(retries.list(), [["1@a", "erster Versuch gescheitert"]]);
  // Takt mit Generation gen; waehrend sein Lauf dauert, kehrt die Cloud zurueck.
  retries.clear();
  assert.deepEqual(retries.list(), []);
  retries.note("1@a", "Lauf endet nach der Rueckkehr", gen);
  retries.note("2@b", "Lauf endet nach der Rueckkehr", gen);
  assert.deepEqual(retries.list(), []);
  // Neuer Notbetrieb, neuer Takt: wieder vormerken und austragen.
  const next = retries.generation;
  assert.notEqual(next, gen);
  retries.note("3@c", "neuer Notbetrieb", next);
  retries.note("4@d", "neuer Notbetrieb", next);
  retries.note("3@c", null, next);
  retries.delete("4@d");
  assert.deepEqual(retries.list(), []);
});

test("Wiederholung im Notbetrieb (Ablauf): Rolltor zu und Licht aus scheitern, hoechstens 3 Versuche, mindestens 60 s auseinander, Gelungenes nie doppelt", () => {
  // Termin 22:00, Nachholfrist 30 Minuten, Kontakt bis 21:59; Takt alle 20 s ab Beginn des Notbetriebs.
  const devices = new Map<number, OutageDevice>([
    [9, shelly("ROLLTOR", "192.168.1.40")],
    [7, shelly("BELEUCHTUNG", "192.168.1.41")],
    [8, shelly("BELEUCHTUNG", "192.168.1.42")],
  ]);
  const actions: TestAction[] = [
    { id: 1, key: "DEVICE:9:close", kind: "DEVICE", deviceId: 9, deviceAction: "close" },
    { id: 2, key: "DEVICE:7:deactivate", kind: "DEVICE", deviceId: 7, deviceAction: "deactivate" },
    { id: 3, key: "DEVICE:8:open", kind: "DEVICE", deviceId: 8, deviceAction: "open" },
    { id: 4, key: "NOTIFY:PUSH", kind: "NOTIFY", deviceId: null, deviceAction: null },
  ];
  // Antworten im LAN je Versuch: Rolltor scheitert zweimal, Licht aus einmal; Licht ein scheitert immer.
  const hub = outageHub([planRule(4, [T], actions)], T - MIN, {
    "DEVICE:9:close": [false, false, true],
    "DEVICE:7:deactivate": [false, true],
    "DEVICE:8:open": [false, false, false],
  }, devices);
  const first = T - MIN + OUTAGE_AFTER_MS + 20_000;
  for (let now = first; now < T + 30 * MIN; now += 20_000) hub.tick(now);
  const times = (key: string) => hub.calls.filter((c) => c.key === key).map((c) => (c.at - first) / 1000);
  // Rolltor: drei Versuche, je 60 s auseinander, der dritte gelingt.
  assert.deepEqual(times("DEVICE:9:close"), [0, 60, 120]);
  // Licht aus: gelingt im zweiten Versuch und laeuft danach nicht noch einmal.
  assert.deepEqual(times("DEVICE:7:deactivate"), [0, 60]);
  // Licht ein: nie wiederholt.
  assert.deepEqual(times("DEVICE:8:open"), [0]);
  assert.equal(OUTAGE_RETRY_ATTEMPTS, 3);
  // Jede Wiederholung nur mit dem, was noch fehlte; kein Erfolg, solange Licht ein und Benachrichtigung fehlen.
  assert.deepEqual(hub.runs.map((r) => r.details.map((d) => d.key)), [
    ["DEVICE:9:close", "DEVICE:7:deactivate", "DEVICE:8:open", "NOTIFY:PUSH"],
    ["DEVICE:9:close", "DEVICE:7:deactivate"],
    ["DEVICE:9:close"],
  ]);
  assert.deepEqual(hub.runs.map((r) => r.success), [false, false, false]);
  assert.equal(hub.runs[1].errorMessage, "DEVICE:9:close: Zeitüberschreitung; Noch offen aus diesem Termin: 2 Aktionen");
  assert.equal(hub.runs[2].errorMessage, "Noch offen aus diesem Termin: 2 Aktionen");
  assert.deepEqual(hub.retries.list(), []);
});

test("Wiederholung im Notbetrieb (Ablauf): Hat ein spaeterer Termin das Licht eingeschaltet, wiederholt der Hub nur noch das Rolltor", () => {
  // A 22:00 Licht aus und Rolltor zu, B 22:02:30 Licht an; Kontakt bis 21:59, Takt alle 20 s ab 22:02:20.
  const rules = [planRule(1, [T], [lightOff, gateClose]), planRule(2, [T + 2 * MIN + 30_000], [lightOn])];
  const hub = outageHub(rules, T - MIN, { "DEVICE:5:deactivate": [false], "DEVICE:9:close": [false, true] });
  const first = T - MIN + OUTAGE_AFTER_MS + 20_000;
  for (let now = first; now < T + 30 * MIN; now += 20_000) hub.tick(now);
  assert.deepEqual(hub.calls.map((c) => [(c.at - first) / 1000, c.key]), [
    [0, "DEVICE:5:deactivate"],
    [0, "DEVICE:9:close"],
    [20, "DEVICE:5:open"],
    [60, "DEVICE:9:close"],
  ]);
  assert.equal(hub.state.get(5), "open");
  assert.equal(hub.state.get(9), "close");
  // Die Wiederholung von A: nur das Rolltor; kein Erfolg, weil dem Termin das Licht weiter fehlt.
  const retry = hub.runs[2];
  assert.equal(retry.ruleId, 1);
  assert.deepEqual(retry.details.map((d) => [d.key, d.ok]), [["DEVICE:9:close", true]]);
  assert.equal(retry.success, false);
  assert.equal(retry.errorMessage, "Noch offen aus diesem Termin: 1 Aktion");
  assert.deepEqual(hub.retries.list(), []);
});
