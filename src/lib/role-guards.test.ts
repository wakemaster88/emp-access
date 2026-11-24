import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hubTaskAllowedForUser,
  PERSON_OPENER_DEFAULTS,
  personHasOpener,
  personOpenerChangeNeedsAdmin,
  personOpenerScopeChangeNeedsAdmin,
  SURVEILLANCE_DEFAULTS,
  surveillancePatchNeedsAdmin,
  withoutDeviceSecrets,
  type SurveillanceStored,
} from "./role-guards";

test("Geraetezeile verliert Token und Shelly-Schluessel, sonst nichts", () => {
  const row = { id: 7, name: "Eingang", apiToken: "x", shellyAuthKey: "y", shellyId: "abc", control: "DOOR" };
  const out = withoutDeviceSecrets(row);
  assert.deepEqual(out, { id: 7, name: "Eingang", shellyId: "abc", control: "DOOR" });
  assert.equal("apiToken" in out, false);
  assert.equal("shellyAuthKey" in out, false);
  // Das Original bleibt unveraendert.
  assert.equal(row.apiToken, "x");
});

test("USER darf nur Schnappschuss und Tueroeffnen als Hub-Auftrag anlegen", () => {
  assert.equal(hubTaskAllowedForUser("CAMERA_SNAPSHOT"), true);
  assert.equal(hubTaskAllowedForUser("DOORBIRD_OPEN"), true);
  for (const type of ["SERVICE_RESTART", "HUB_LOG", "DOORBIRD_HOLD", "SHELLY_SWITCH", "NETWORK_SCAN", "PING"]) {
    assert.equal(hubTaskAllowedForUser(type), false, type);
  }
  assert.equal(hubTaskAllowedForUser(undefined), false);
  assert.equal(hubTaskAllowedForUser(42), false);
});

const stored: SurveillanceStored = {
  scheduleEnabled: true,
  daysOfWeek: 127,
  windowStart: "22:00",
  windowEnd: "06:00",
  cooldownMinutes: 5,
  alertOnPerson: true,
  alertOnVehicle: false,
  alertTelegram: true,
  cameraIds: [1, 2],
};

test("Scharf/unscharf mit unveraendertem Formular ist Bedienung", () => {
  assert.equal(surveillancePatchNeedsAdmin({ manualArmed: true }, stored), false);
  assert.equal(
    surveillancePatchNeedsAdmin({ ...stored, cameraIds: [2, 1], manualArmed: false }, stored),
    false,
  );
});

test("Aenderungen an Zeitplan, Alarmwegen oder Kameras sind Verwaltung", () => {
  assert.equal(surveillancePatchNeedsAdmin({ manualArmed: true, scheduleEnabled: false }, stored), true);
  assert.equal(surveillancePatchNeedsAdmin({ windowEnd: "07:00" }, stored), true);
  assert.equal(surveillancePatchNeedsAdmin({ alertTelegram: false }, stored), true);
  assert.equal(surveillancePatchNeedsAdmin({ cameraIds: [1] }, stored), true);
  assert.equal(surveillancePatchNeedsAdmin({ cameraIds: [1, 2, 3] }, stored), true);
});

test("Leeres Zeitfenster gilt wie die gemeldete Voreinstellung", () => {
  const empty = { ...stored, windowStart: null, windowEnd: null };
  assert.equal(surveillancePatchNeedsAdmin({ windowStart: "22:00", windowEnd: "08:00" }, empty), false);
  assert.equal(surveillancePatchNeedsAdmin({ windowStart: null }, empty), false);
});

test("Ohne gespeicherte Konfiguration: Scharfschalten mit Voreinstellungen ist Bedienung", () => {
  assert.equal(surveillancePatchNeedsAdmin({ manualArmed: true }, null), false);
  // So schickt es die Oberflaeche: das ganze Formular mit den Werten aus GET.
  assert.equal(surveillancePatchNeedsAdmin({ manualArmed: true, ...SURVEILLANCE_DEFAULTS }, null), false);
  assert.equal(surveillancePatchNeedsAdmin({ manualArmed: true, alertTelegram: false }, null), true);
  assert.equal(surveillancePatchNeedsAdmin({ manualArmed: true, cameraIds: [4] }, null), true);
});

test("Person mit Oeffner: wieder aktivieren oder Kamera wechseln ist Verwaltung", () => {
  const withOpener = { triggerOnDetection: true, shellyDeviceId: 3, isActive: false, cameraId: 1 };
  assert.equal(personHasOpener(withOpener), true);
  assert.equal(personOpenerScopeChangeNeedsAdmin({ isActive: true }, withOpener), true);
  assert.equal(personOpenerScopeChangeNeedsAdmin({ cameraId: 2 }, withOpener), true);
  assert.equal(personOpenerScopeChangeNeedsAdmin({ cameraId: 1, isActive: false }, withOpener), false);
  // Ohne Oeffner bleibt beides Bedienung.
  const plain = { triggerOnDetection: false, shellyDeviceId: null, isActive: false, cameraId: 1 };
  assert.equal(personHasOpener(plain), false);
  assert.equal(personOpenerScopeChangeNeedsAdmin({ isActive: true, cameraId: 2 }, plain), false);
});

test("Person ohne Oeffner anlegen ist Bedienung, mit Oeffner Verwaltung", () => {
  assert.equal(
    personOpenerChangeNeedsAdmin({ triggerOnDetection: false }, PERSON_OPENER_DEFAULTS),
    false,
  );
  assert.equal(personOpenerChangeNeedsAdmin({}, PERSON_OPENER_DEFAULTS), false);
  assert.equal(
    personOpenerChangeNeedsAdmin({ shellyDeviceId: null, timerSeconds: null }, PERSON_OPENER_DEFAULTS),
    false,
  );
  assert.equal(
    personOpenerChangeNeedsAdmin({ triggerOnDetection: true }, PERSON_OPENER_DEFAULTS),
    true,
  );
  assert.equal(personOpenerChangeNeedsAdmin({ shellyDeviceId: 3 }, PERSON_OPENER_DEFAULTS), true);
});

test("Unveraenderter Oeffner beim Bearbeiten ist keine Verwaltung", () => {
  const stored = { triggerOnDetection: true, shellyDeviceId: 3, shellyAction: "ON", timerSeconds: 5 };
  assert.equal(personOpenerChangeNeedsAdmin({ ...stored }, stored), false);
  assert.equal(personOpenerChangeNeedsAdmin({ timerSeconds: 10 }, stored), true);
  assert.equal(personOpenerChangeNeedsAdmin({ shellyAction: "TOGGLE" }, stored), true);
});
