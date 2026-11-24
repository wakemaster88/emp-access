import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPIRING_HUB_TASK_TYPES,
  SWITCH_COMMAND_MAX_AGE_MS,
  checkHubTaskPayload,
  deviceTaskSetAt,
  expiredSwitchCommandsWhere,
  hubTaskActor,
  piOpenTaskExpired,
  switchCommandCutoff,
  withActor,
} from "./hub-task-rules";

const now = new Date("2026-11-24T12:00:00.000Z");

test("Verfallsgrenze liegt eine Minute vor jetzt", () => {
  assert.equal(switchCommandCutoff(now).getTime(), now.getTime() - SWITCH_COMMAND_MAX_AGE_MS);
});

test("Zustaende und lange Laeufe verfallen nicht", () => {
  const expiring = new Set<string>(EXPIRING_HUB_TASK_TYPES);
  for (const type of [
    "DOORBIRD_HOLD",
    "NETWORK_SCAN",
    "SWITCH_SYNC",
    "FACE_ENROLL",
    "FACE_ANALYZE",
    "SERVICE_RESTART",
    "HUB_LOG",
    "SYSTEM_CHECK",
    "SOUNDWEB_SYNC",
    "AGENT_TOOL",
    "CAMERA_IR",
    "MOWER_ACTION",
  ]) {
    assert.equal(expiring.has(type), false, type);
  }
  for (const type of ["DOORBIRD_OPEN", "CAMERA_SIREN", "HUE_SET", "SHELLY_SWITCH", "SOUNDWEB_SET", "SCAN_SNAPSHOT"]) {
    assert.equal(expiring.has(type), true, type);
  }
});

test("Abholung: nur Einschalt-Befehle von Licht, Relais und Sirene verfallen", () => {
  const where = expiredSwitchCommandsWhere(7, now);
  assert.equal(where.accountId, 7);
  assert.equal(where.status, "PENDING");
  assert.equal(where.createdAt.lt.getTime(), now.getTime() - SWITCH_COMMAND_MAX_AGE_MS);

  // Nachbildung des Filters fuer einen Auftrag (Prisma-JSON-Pfad ["on"]).
  const matches = (type: string, payload: Record<string, unknown>) =>
    where.OR.some((cond) => {
      const typeOk = typeof cond.type === "string" ? cond.type === type : cond.type.in.includes(type as never);
      if (!typeOk) return false;
      const filter = "payload" in cond ? cond.payload : undefined;
      if (!filter) return true;
      return payload[filter.path[0]] === filter.equals;
    });

  for (const type of ["DOORBIRD_OPEN", "CAMERA_PTZ", "CAMERA_SCENE", "SOUNDWEB_SET", "SCAN_SNAPSHOT"]) {
    assert.equal(matches(type, {}), true, type);
  }
  for (const type of ["HUE_SET", "CAMERA_SPOTLIGHT", "CAMERA_SIREN"]) {
    assert.equal(matches(type, { on: true }), true, type);
    assert.equal(matches(type, { on: false }), false, type);
    // Hub liest hier nur on === true als Ein; Text ist dort Aus.
    assert.equal(matches(type, { on: "true" }), false, type);
  }
  assert.equal(matches("SHELLY_SWITCH", { on: true }), true);
  assert.equal(matches("SHELLY_SWITCH", { on: "true" }), true);
  assert.equal(matches("SHELLY_SWITCH", { on: "on" }), true);
  assert.equal(matches("SHELLY_SWITCH", { on: false }), false);
  assert.equal(matches("SHELLY_SWITCH", { on: "off" }), false);
  // Umschalten ohne on bleibt wie bisher.
  assert.equal(matches("SHELLY_SWITCH", {}), false);
  for (const type of ["DOORBIRD_HOLD", "CAMERA_IR", "NETWORK_SCAN", "AGENT_TOOL"]) {
    assert.equal(matches(type, { on: true }), false, type);
  }
});

test("Einmal-Oeffnen am Pi verfaellt nach 60 s, nur mit bekanntem Zeitpunkt", () => {
  const old = new Date(now.getTime() - 61_000);
  const fresh = new Date(now.getTime() - 30_000);
  assert.equal(piOpenTaskExpired(1, old, now), true);
  assert.equal(piOpenTaskExpired(1, fresh, now), false);
  assert.equal(piOpenTaskExpired(1, null, now), false);
  assert.equal(piOpenTaskExpired(1, undefined, now), false);
  // NOT-AUF und Deaktiviert sind Zustaende.
  assert.equal(piOpenTaskExpired(2, old, now), false);
  assert.equal(piOpenTaskExpired(3, old, now), false);
  assert.equal(piOpenTaskExpired(0, old, now), false);
});

test("taskSetAt wird bei 0 geloescht, sonst gesetzt", () => {
  assert.equal(deviceTaskSetAt(0, now), null);
  assert.equal(deviceTaskSetAt(1, now), now);
  assert.equal(deviceTaskSetAt(3, now), now);
});

test("Benutzerangabe aus der Sitzung", () => {
  assert.deepEqual(hubTaskActor({ id: "7", name: "Kasse" }), { adminId: 7, name: "Kasse" });
  assert.deepEqual(hubTaskActor({ id: "x", name: null }), { adminId: null, name: null });
  assert.deepEqual(hubTaskActor(undefined), { adminId: null, name: null });
});

test("by wird nur an Objekt- oder leere Payloads gehaengt", () => {
  const by = { adminId: 1, name: "A" };
  assert.deepEqual(withActor(undefined, by), { by });
  assert.deepEqual(withActor({ cameraId: 3 }, by), { cameraId: 3, by });
  assert.deepEqual(withActor([1, 2], by), [1, 2]);
  assert.equal(withActor("x", by), "x");
});

test("Payloads der Oberflaeche bestehen die Pruefung", () => {
  const snap = checkHubTaskPayload("CAMERA_SNAPSHOT", { cameraId: 4 });
  assert.deepEqual(snap, { ok: true, payload: { cameraId: 4 }, cameraId: 4 });
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: 5 }).ok, true);
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: 5, relay: 1, extra: "x" }).ok, true);
  assert.equal(checkHubTaskPayload("SERVICE_RESTART", { service: "tracker" }).ok, true);
  assert.equal(checkHubTaskPayload("SERVICE_RESTART", { service: "hub" }).ok, true);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "hub", lines: 500, grep: undefined }).ok, true);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "error", lines: 200, grep: "fehler", at: now.toISOString() }).ok, true);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "improve", lines: 1500, before: 1024 }).ok, true);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "hub", lines: 200, after: 0 }).ok, true);
});

test("Ungueltige Payloads werden abgelehnt", () => {
  assert.equal(checkHubTaskPayload("CAMERA_SNAPSHOT", {}).ok, false);
  assert.equal(checkHubTaskPayload("CAMERA_SNAPSHOT", undefined).ok, false);
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: "abc" }).ok, false);
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: 2, relay: 0 }).ok, false);
  assert.equal(checkHubTaskPayload("SERVICE_RESTART", { service: "shell" }).ok, false);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "../etc" }).ok, false);
  // Kamera-Typ ohne eigenes Schema: cameraId bleibt Pflicht.
  const ptz = checkHubTaskPayload("CAMERA_PTZ", { cameraId: "9", op: "Left" });
  assert.deepEqual(ptz, { ok: true, payload: { cameraId: "9", op: "Left" }, cameraId: 9 });
  assert.equal(checkHubTaskPayload("CAMERA_SIREN", { on: true }).ok, false);
});

test("Typen ohne Schema bleiben unveraendert", () => {
  assert.deepEqual(checkHubTaskPayload("NETWORK_SCAN", undefined), { ok: true, payload: undefined, cameraId: null });
  assert.deepEqual(checkHubTaskPayload("PING", { host: "h" }), { ok: true, payload: { host: "h" }, cameraId: null });
});
