import { test } from "node:test";
import assert from "node:assert/strict";
import { cooldownActive, doorbirdFallback, lacksActuator, resolveDoorbirdId } from "./vehicle-actuate-rules.js";

test("DoorBird: ohne Zuweisung kein Ziel, auch wenn genau eine eingerichtet ist", () => {
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: null }, [11], false), null);
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: null }, [], false), null);
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: null }, [11, 12], false), null);
});

test("DoorBird: mit Zuweisung deren ID", () => {
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: 12 }, [11, 12], false), 12);
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: 12 }, [11], false), 12);
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: 12 }, [], true), 12);
});

test("DoorBird: Rückschalter stellt den Rückfall auf die einzige DoorBird her", () => {
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: null }, [11], true), 11);
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: null }, [11, 12], true), null);
  assert.equal(resolveDoorbirdId({ doorbirdCameraId: null }, [], true), null);
});

test("HUB_DOORBIRD_FALLBACK: 1, true, ja, on schalten den Rückfall ein, sonst aus", () => {
  for (const v of ["1", "true", "TRUE", "ja", "Ja", "on", " on "]) assert.equal(doorbirdFallback(v), true, v);
  for (const v of [undefined, "", "0", "false", "nein", "off", "yes", "2"]) assert.equal(doorbirdFallback(v), false, String(v));
});

test("Fehlender Aktor: nur ohne DoorBird, ohne Shelly am Hub und ohne Shelly in der Cloud", () => {
  // Weder DoorBird noch Shelly zugewiesen.
  assert.equal(lacksActuator({ shellyIp: null, shellyLinked: false }, null), true);
  // Shelly ohne IP-Adresse: den schaltet die Cloud über die Shelly-Cloud.
  assert.equal(lacksActuator({ shellyIp: null, shellyLinked: true }, null), false);
  // DoorBird oder Shelly am Hub: kein fehlender Aktor.
  assert.equal(lacksActuator({ shellyIp: null, shellyLinked: false }, 11), false);
  assert.equal(lacksActuator({ shellyIp: "192.0.2.10", shellyLinked: true }, null), false);
  // Ältere Cloud ohne die Angabe: wie bisher nach dem, was der Hub schalten kann.
  assert.equal(lacksActuator({ shellyIp: null, shellyLinked: null }, null), true);
  assert.equal(lacksActuator({ shellyIp: "192.0.2.10", shellyLinked: null }, null), false);
});

test("Sperrzeit: läuft nach einer Schaltung, ein Zeitpunkt weit in der Zukunft zählt nicht", () => {
  const now = Date.UTC(2026, 10, 25, 18, 0);
  const min = 60_000;
  const ahead = 5 * min;
  assert.equal(cooldownActive(null, now, 2 * min, ahead), false);
  assert.equal(cooldownActive(now - 30_000, now, 2 * min, ahead), true);
  assert.equal(cooldownActive(now - 2 * min, now, 2 * min, ahead), false);
  assert.equal(cooldownActive(now - 3 * min, now, 2 * min, ahead), false);
  // Uhr der Cloud ein wenig vor: sperrt weiter.
  assert.equal(cooldownActive(now + 2 * min, now, 2 * min, ahead), true);
  assert.equal(cooldownActive(now + ahead, now, 2 * min, ahead), true);
  // Mehr als 5 min in der Zukunft: zählt nicht.
  assert.equal(cooldownActive(now + ahead + 1, now, 2 * min, ahead), false);
  assert.equal(cooldownActive(now + 6 * 60 * min, now, 2 * min, ahead), false);
});
