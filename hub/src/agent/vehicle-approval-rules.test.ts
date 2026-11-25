import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalBody,
  approvalDoorbird,
  approvalQuestion,
  approvedText,
  approvedWithDoorbird,
  retryWithoutDoorbird,
} from "./vehicle-approval-rules.js";

test("Genehmigung: DoorBird nur, wenn genau eine eingerichtet ist", () => {
  assert.equal(approvalDoorbird([11]), 11);
  assert.equal(approvalDoorbird([]), null);
  assert.equal(approvalDoorbird([11, 12]), null);
});

test("Genehmigung: Inhalt mit Kamera und DoorBird, ohne leere Felder", () => {
  assert.deepEqual(approvalBody("GT-AB 4321", 9, 11), { plate: "GT-AB 4321", cameraId: 9, doorbirdCameraId: 11 });
  assert.deepEqual(approvalBody("GT-AB 4321", 9, null), { plate: "GT-AB 4321", cameraId: 9 });
  assert.deepEqual(approvalBody("GT-AB 4321", null, null), { plate: "GT-AB 4321" });
});

test("Genehmigung: Öffnen nur versprochen, wenn die Cloud die DoorBird übernommen hat", () => {
  assert.equal(approvedWithDoorbird({ id: 1, doorbirdCameraId: 11 }, 11), true);
  // Cloud, die das Feld nicht kennt: legt ohne DoorBird an.
  assert.equal(approvedWithDoorbird({ id: 1, doorbirdCameraId: null }, 11), false);
  assert.equal(approvedWithDoorbird({ id: 1 }, 11), false);
  assert.equal(approvedWithDoorbird({ error: "Ein Fahrzeug mit diesem Kennzeichen existiert bereits" }, 11), false);
  assert.equal(approvedWithDoorbird({ id: 1, doorbirdCameraId: 11 }, null), false);
  assert.equal(approvedWithDoorbird(null, 11), false);
});

test("Genehmigung: lehnt die Cloud die DoorBird ab, noch einmal ohne", () => {
  const withDoor = approvalBody("GT-AB 4321", 9, 11);
  assert.equal(retryWithoutDoorbird(400, "DoorBird nicht gefunden", withDoor), true);
  assert.equal(retryWithoutDoorbird(400, "DoorBird nicht gefunden", approvalBody("GT-AB 4321", 9, null)), false);
  assert.equal(retryWithoutDoorbird(400, "Kamera nicht gefunden", withDoor), false);
  assert.equal(retryWithoutDoorbird(500, "DoorBird nicht gefunden", withDoor), false);
});

test("Genehmigung: Frage und Antwort versprechen das Öffnen nur mit DoorBird", () => {
  assert.match(approvalQuestion(11, true), /an dieser Kamera automatisch öffnen/);
  assert.doesNotMatch(approvalQuestion(11, false), /Kamera/);
  assert.match(approvalQuestion(null, true), /nicht automatisch/);
  assert.doesNotMatch(approvalQuestion(null, true), /automatisch öffnen/);
  assert.equal(
    approvedText("GT-AB 4321", "Einfahrt", true),
    "✅ GT-AB 4321 ist genehmigt (Kamera Einfahrt). Kein Alarm mehr für dieses Fahrzeug, das Tor öffnet bei Erkennung automatisch."
  );
  assert.equal(
    approvedText("GT-AB 4321", null, false),
    "✅ GT-AB 4321 ist genehmigt. Kein Alarm mehr für dieses Fahrzeug. " +
      "Automatisch öffnet das Tor erst, wenn in der Fahrzeugverwaltung eine DoorBird zugewiesen ist."
  );
});
