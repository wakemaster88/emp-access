import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOOR_HOLD_BEFORE_FIELD,
  DOOR_HOLD_MAX_MINUTES,
  doorHoldRevert,
  doorHoldTaskPayload,
  doorHoldTaskPlan,
  doorHoldUntilOfTask,
  holdPulseAnswer,
  isDoorHoldActive,
  parseDoorHoldMinutes,
} from "./door-hold";

const now = new Date("2026-11-26T09:00:00.000Z");
const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);

test("Impuls-Meldung: Antwort nennt den Zielzustand, null = aus", () => {
  assert.deepEqual(holdPulseAnswer(inMinutes(30)), { ok: true, until: "2026-11-26T09:30:00.000Z" });
  assert.deepEqual(holdPulseAnswer(null), { ok: true, until: null });
  // Die bisherigen Felder bleiben.
  assert.equal(holdPulseAnswer(null).ok, true);
});

test("Obergrenze der Oberflaeche: 1 bis 12 Stunden in ganzen Minuten", () => {
  assert.equal(DOOR_HOLD_MAX_MINUTES, 12 * 60);
  assert.equal(parseDoorHoldMinutes(15), 15);
  assert.equal(parseDoorHoldMinutes("60"), 60);
  assert.equal(parseDoorHoldMinutes(DOOR_HOLD_MAX_MINUTES), DOOR_HOLD_MAX_MINUTES);
  assert.equal(parseDoorHoldMinutes(DOOR_HOLD_MAX_MINUTES + 1), null);
  assert.equal(parseDoorHoldMinutes(0), null);
  assert.equal(parseDoorHoldMinutes(1.5), null);
  assert.equal(parseDoorHoldMinutes("x"), null);
});

test("Auftrag ueber /api/hub/tasks: Zielzustand so, wie der Hub den Auftrag liest", () => {
  assert.deepEqual(doorHoldUntilOfTask({ cameraId: 2, until: inMinutes(60).toISOString() }, now), inMinutes(60));
  // Beenden: kein until, leer, kein Text, vergangen oder nicht lesbar.
  for (const payload of [
    { cameraId: 2 },
    { cameraId: 2, until: null },
    { cameraId: 2, until: "" },
    { cameraId: 2, until: inMinutes(60).getTime() },
    { cameraId: 2, until: inMinutes(-1).toISOString() },
    { cameraId: 2, until: now.toISOString() },
    { cameraId: 2, until: "morgen" },
    null,
    undefined,
  ]) {
    assert.equal(doorHoldUntilOfTask(payload, now), null, JSON.stringify(payload));
  }
});

test("Aktiv nur mit Endzeitpunkt in der Zukunft", () => {
  assert.equal(isDoorHoldActive({ until: inMinutes(1).toISOString() }, now.getTime()), true);
  assert.equal(isDoorHoldActive({ until: now.toISOString() }, now.getTime()), false);
  assert.equal(isDoorHoldActive({ until: null }, now.getTime()), false);
});

const doorbird = (over: Partial<{ kind: string | null; enabled: boolean; doorHoldUntil: Date | null }> = {}) => ({
  kind: "DOORBIRD",
  enabled: true,
  doorHoldUntil: null,
  ...over,
});

test("Auftrag ueber /api/hub/tasks an eine deaktivierte DoorBird: Start abgelehnt, kein Zielzustand; Beenden geht", () => {
  const start = { cameraId: 2, until: inMinutes(360).toISOString() };
  assert.deepEqual(doorHoldTaskPlan(doorbird({ enabled: false }), start, now), {
    action: "ablehnen",
    error: "Kamera ist deaktiviert",
  });
  assert.deepEqual(doorHoldTaskPlan(doorbird({ enabled: false, doorHoldUntil: inMinutes(5) }), { cameraId: 2 }, now), {
    action: "setzen",
    until: null,
    before: inMinutes(5),
  });
  assert.deepEqual(doorHoldTaskPlan(doorbird({ doorHoldUntil: inMinutes(5) }), start, now), {
    action: "setzen",
    until: inMinutes(360),
    before: inMinutes(5),
  });
  // Keine DoorBird: Camera bleibt unberuehrt, wie bisher.
  assert.deepEqual(doorHoldTaskPlan(doorbird({ kind: "REOLINK" }), start, now), { action: "keiner" });
});

test("Auftrag ueber /api/hub/tasks: nur ein Start traegt den Zielzustand davor, ein mitgeschicktes Feld zaehlt nicht", () => {
  const start = { cameraId: 2, until: inMinutes(60).toISOString(), relay: 1 };
  const plan = doorHoldTaskPlan(doorbird({ doorHoldUntil: inMinutes(5) }), start, now);
  assert.deepEqual(doorHoldTaskPayload(start, plan), { ...start, [DOOR_HOLD_BEFORE_FIELD]: inMinutes(5).toISOString() });
  assert.deepEqual(
    doorHoldTaskPayload(start, doorHoldTaskPlan(doorbird(), start, now)),
    { ...start, [DOOR_HOLD_BEFORE_FIELD]: null }
  );
  const end = { cameraId: 2, until: null, [DOOR_HOLD_BEFORE_FIELD]: inMinutes(9).toISOString() };
  assert.deepEqual(doorHoldTaskPayload(end, doorHoldTaskPlan(doorbird(), end, now)), { cameraId: 2, until: null });
  const other = { ...start, [DOOR_HOLD_BEFORE_FIELD]: null };
  assert.deepEqual(doorHoldTaskPayload(other, { action: "keiner" }), start);
});

test("Gescheiterter Start aus /api/hub/tasks: Zielzustand zurueck auf den Wert davor, sonst nichts", () => {
  const until = inMinutes(360);
  const payload = { cameraId: 2, until: until.toISOString(), [DOOR_HOLD_BEFORE_FIELD]: inMinutes(5).toISOString(), by: {} };
  assert.deepEqual(doorHoldRevert({ type: "DOORBIRD_HOLD", payload }, false), {
    cameraId: 2,
    until,
    before: inMinutes(5),
  });
  assert.deepEqual(doorHoldRevert({ type: "DOORBIRD_HOLD", payload: { ...payload, [DOOR_HOLD_BEFORE_FIELD]: null } }, false), {
    cameraId: 2,
    until,
    before: null,
  });
  // Gelungen, anderer Typ, ohne das Feld (Oberflaeche, aeltere Auftraege), Beenden: nichts.
  assert.equal(doorHoldRevert({ type: "DOORBIRD_HOLD", payload }, true), null);
  assert.equal(doorHoldRevert({ type: "DOORBIRD_OPEN", payload }, false), null);
  assert.equal(doorHoldRevert({ type: "DOORBIRD_HOLD", payload: { cameraId: 2, until: until.toISOString() } }, false), null);
  assert.equal(doorHoldRevert({ type: "DOORBIRD_HOLD", payload: { cameraId: 2, until: null, [DOOR_HOLD_BEFORE_FIELD]: null } }, false), null);
  assert.equal(doorHoldRevert({ type: "DOORBIRD_HOLD", payload: { ...payload, [DOOR_HOLD_BEFORE_FIELD]: "gestern" } }, false), null);
  assert.equal(doorHoldRevert({ type: "DOORBIRD_HOLD", payload: null }, false), null);
});
