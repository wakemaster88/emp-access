import { test } from "node:test";
import assert from "node:assert/strict";
import { parkingLotState, parseParkingSnapshot, snapshotMarksSeen } from "./parking";

const lot = (extra: Record<string, unknown>) => ({
  kioskId: "halle",
  name: "Halle",
  ip: "10.0.0.20",
  mode: "vehicle-zone",
  lastUpdate: 1_700_000_000_000,
  lastError: null,
  fps: 10,
  zone: null,
  ...extra,
});

test("Neuer Hub, Zählung unbekannt (count null): Zahl 0 für ältere Ansichten, Zustand unbekannt", () => {
  const snap = parseParkingSnapshot({
    parking: { at: "2026-11-26T10:00:00.000Z", trackerOnline: true, lots: [lot({ count: null, state: "unbekannt", lastError: "RTSP-Stream abgebrochen" })] },
  });
  assert.equal(snap?.lots[0].count, 0);
  assert.equal(snap?.lots[0].state, "unbekannt");
  assert.equal(snap?.lots[0].lastError, "RTSP-Stream abgebrochen");
  // Was eine ältere Ansicht damit rechnet: Summe und Anzeige bleiben Zahlen.
  assert.equal(snap!.lots.reduce((sum, l) => sum + l.count, 0), 0);
});

test("Zählung bekannt: wie bisher", () => {
  const snap = parseParkingSnapshot({ parking: { trackerOnline: true, lots: [lot({ count: 2, state: "ok" })] } });
  assert.equal(snap?.lots[0].count, 2);
  assert.equal(snap?.lots[0].state, "ok");
});

test("Älterer Hub ohne state: unbekannt bei Tracker offline oder Fehler, sonst ok", () => {
  assert.equal(parkingLotState({ count: 3 }, true), "ok");
  assert.equal(parkingLotState({ count: 0 }, false), "unbekannt");
  assert.equal(parkingLotState({ count: 3, lastError: "zone fehlt" }, true), "unbekannt");
  assert.equal(parkingLotState({ count: 3, lastError: "" }, true), "ok");
  const old = parseParkingSnapshot({ parking: { trackerOnline: false, lots: [lot({ count: 0 })] } });
  assert.equal(old?.lots[0].state, "unbekannt");
});

test("Bild-Route: „zuletzt gesehen“ für Bilder der Parkfläche nur mit live=1, alle anderen wie bisher", () => {
  assert.equal(snapshotMarksSeen(new URLSearchParams("")), true);
  assert.equal(snapshotMarksSeen(new URLSearchParams("live=0")), true);
  assert.equal(snapshotMarksSeen(new URLSearchParams("source=parking&live=1")), true);
  assert.equal(snapshotMarksSeen(new URLSearchParams("source=parking&live=0")), false);
  assert.equal(snapshotMarksSeen(new URLSearchParams("source=parking")), false);
});
