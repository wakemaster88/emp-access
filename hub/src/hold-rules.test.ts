import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOLD_CLOCK_SLACK_MS,
  HOLD_MAX_MS,
  afterReport,
  fastRetrySafe,
  reportApplies,
  retryDelayAfter,
  retryDelays,
  retryStillDue,
} from "./hold-rules.js";

const NOW = Date.UTC(2026, 10, 26, 9, 0, 0);
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const LOCAL = NOW + 30 * MIN;

test("Antwort null: Offenhalten endet", () => {
  assert.deepEqual(afterReport(LOCAL, null, NOW), { action: "stop" });
});

test("Antwort mit einem Zeitpunkt, der vorbei ist: Offenhalten endet", () => {
  assert.deepEqual(afterReport(LOCAL, iso(NOW - MIN), NOW), { action: "stop" });
  assert.deepEqual(afterReport(LOCAL, iso(NOW), NOW), { action: "stop" });
});

test("Antwort mit dem lokalen Ende: weitermachen", () => {
  assert.deepEqual(afterReport(LOCAL, iso(LOCAL), NOW), { action: "keep" });
});

test("Antwort mit anderem Ende in der Zukunft: verlaengern oder verkuerzen", () => {
  assert.deepEqual(afterReport(LOCAL, iso(NOW + 2 * 60 * MIN), NOW), { action: "adopt", until: NOW + 2 * 60 * MIN });
  assert.deepEqual(afterReport(LOCAL, iso(NOW + 5 * MIN), NOW), { action: "adopt", until: NOW + 5 * MIN });
});

test("keine Antwort oder kein Feld (aeltere Cloud): weder beenden noch verlaengern", () => {
  assert.deepEqual(afterReport(LOCAL, undefined, NOW), { action: "keep" });
  // Felder, die kein Zeitpunkt sind, zaehlen wie ein fehlendes Feld.
  for (const odd of ["", "morgen", 0, NOW + MIN, true, {}]) {
    assert.deepEqual(afterReport(LOCAL, odd, NOW), { action: "keep" }, JSON.stringify(odd));
  }
});

test("Obergrenze: ein uebernommenes Ende liegt hoechstens 12 Stunden (plus Uhrabweichung) in der Zukunft", () => {
  assert.equal(HOLD_MAX_MS, 12 * 60 * MIN);
  const atLimit = NOW + HOLD_MAX_MS;
  assert.deepEqual(afterReport(LOCAL, iso(atLimit), NOW), { action: "adopt", until: atLimit });
  // Die Cloud rechnet mit ihrer Uhr: wenige Minuten darueber gelten noch.
  assert.deepEqual(afterReport(LOCAL, iso(atLimit + HOLD_CLOCK_SLACK_MS), NOW), {
    action: "adopt",
    until: atLimit + HOLD_CLOCK_SLACK_MS,
  });
  // Darueber hinaus nie: Das lokale Ende bleibt.
  assert.deepEqual(afterReport(LOCAL, iso(atLimit + HOLD_CLOCK_SLACK_MS + 1000), NOW), { action: "keep" });
  assert.deepEqual(afterReport(LOCAL, iso(NOW + 3 * 24 * 60 * MIN), NOW), { action: "keep" });
});

test("Antwort zaehlt nur fuer dasselbe Offenhalten mit unveraendertem Ende", () => {
  assert.equal(reportApplies({ sameHold: true, untilAtSend: LOCAL, untilNow: LOCAL }), true);
  // Waehrend der Meldung neu gestartet: Eine spaete null-Antwort beendet das neue nicht.
  assert.equal(reportApplies({ sameHold: false, untilAtSend: LOCAL, untilNow: LOCAL }), false);
  // Waehrend der Meldung per Auftrag verlaengert: Das alte Ende kuerzt nicht zurueck.
  assert.equal(reportApplies({ sameHold: true, untilAtSend: LOCAL, untilNow: LOCAL + 60 * MIN }), false);
});

test("Wiederholung eines gescheiterten Impulses nach 3, 8 und 20 Sekunden, danach im normalen Takt", () => {
  assert.deepEqual(retryDelays(), [3_000, 8_000, 20_000]);
  assert.equal(retryDelayAfter(1), 3_000);
  assert.equal(retryDelayAfter(2), 8_000);
  assert.equal(retryDelayAfter(3), 20_000);
  assert.equal(retryDelayAfter(4), null);
  assert.equal(retryDelayAfter(40), null);
  // Ohne Fehlschlag keine Wiederholung.
  assert.equal(retryDelayAfter(0), null);
  assert.equal(retryDelayAfter(-1), null);
  assert.equal(retryDelayAfter(1.5), null);
  // Jeder Aufruf bekommt eine eigene Liste.
  retryDelays().push(1);
  assert.equal(retryDelays().length, 3);
});

test("Kein wiederholter Impuls nach dem Ende des Offenhaltens", () => {
  assert.equal(retryStillDue({ sameHold: true, now: NOW, until: LOCAL }), true);
  // Ende erreicht.
  assert.equal(retryStillDue({ sameHold: true, now: LOCAL, until: LOCAL }), false);
  assert.equal(retryStillDue({ sameHold: true, now: LOCAL + 1, until: LOCAL }), false);
  // Beendet oder durch ein neues Offenhalten ersetzt.
  assert.equal(retryStillDue({ sameHold: false, now: NOW, until: LOCAL }), false);
});

test("Schnelle Wiederholung nur, wenn das Relais sicher nicht geschaltet hat", () => {
  // Die DoorBird hat mit einem Fehler geantwortet: nicht geschaltet.
  assert.equal(fastRetrySafe({ httpStatus: 500 }), true);
  assert.equal(fastRetrySafe({ httpStatus: 401 }), true);
  assert.equal(fastRetrySafe({ httpStatus: 200 }), false);
  // Verbindung kam nicht zustande: nicht geschaltet.
  assert.equal(fastRetrySafe({ errorName: "TypeError", causeCode: "ECONNREFUSED" }), true);
  assert.equal(fastRetrySafe({ errorName: "TypeError", causeCode: "EHOSTUNREACH" }), true);
  // macOS bei einem stummen Geraet im eigenen Netz, und das Zeitlimit des Verbindungsaufbaus.
  assert.equal(fastRetrySafe({ errorName: "TypeError", causeCode: "EHOSTDOWN" }), true);
  assert.equal(fastRetrySafe({ errorName: "TypeError", causeCode: "UND_ERR_CONNECT_TIMEOUT" }), true);
  // Zeitlimit oder Abbruch mitten in der Anfrage: offen, ob gepulst wurde.
  assert.equal(fastRetrySafe({ errorName: "TimeoutError" }), false);
  assert.equal(fastRetrySafe({ errorName: "AbortError" }), false);
  assert.equal(fastRetrySafe({ errorName: "TypeError", causeCode: "ECONNRESET" }), false);
  assert.equal(fastRetrySafe({ errorName: "TypeError", causeCode: "UND_ERR_SOCKET" }), false);
  assert.equal(fastRetrySafe({}), false);
});
