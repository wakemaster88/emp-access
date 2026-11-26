import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENSURE_EVERY_MS,
  FRAME_LIVE_MAX_AGE_MS,
  PARKING_REPORT_TICK_MS,
  ensureDue,
  frameLive,
  gateMode,
  gateModeLine,
  lotFromCounter,
  parkingCamsHash,
  parkingFrameIdleMs,
  parkingIdleReportMs,
  parkingReportDue,
  parkingReportKey,
  staleMarkDue,
  trackerFrameDue,
  type ParkingCamKey,
  type ParkingSnapshotLike,
} from "./parking-rules.js";

const NOW = 10_000_000;

const halle: ParkingCamKey = { id: "halle", ip: "10.0.0.20", port: 80, channel: 0, username: "kiosk", hasPassword: true };

test("ensureDue: erster Lauf, geaenderte Park-Kameras und einmal je Stunde", () => {
  const h = parkingCamsHash([halle]);
  assert.equal(ensureDue(null, h, 0, NOW), true, "erster Lauf");
  assert.equal(ensureDue(h, h, NOW - 30_000, NOW), false, "gleich nach 30 s");
  assert.equal(ensureDue(h, h, NOW - 3_599_999, NOW), false, "gleich kurz vor einer Stunde");
  assert.equal(ensureDue(h, h, NOW - 3_600_000, NOW), true, "gleich nach einer Stunde");
  assert.equal(ensureDue(h, parkingCamsHash([{ ...halle, ip: "10.0.0.21" }]), NOW - 30_000, NOW), true, "neue Adresse");
  assert.equal(ENSURE_EVERY_MS, 3_600_000);
});

test("Fingerabdruck: id, ip, port, channel und username zaehlen, die Reihenfolge nicht", () => {
  const h = parkingCamsHash([halle]);
  for (const changed of [
    { ...halle, id: "halle2" },
    { ...halle, ip: "10.0.0.21" },
    { ...halle, port: 8080 },
    { ...halle, channel: 1 },
    { ...halle, username: "admin" },
    { ...halle, hasPassword: false },
  ]) {
    assert.notEqual(parkingCamsHash([changed]), h, JSON.stringify(changed));
  }
  const other = { ...halle, id: "tor", ip: "10.0.0.30" };
  assert.equal(parkingCamsHash([halle, other]), parkingCamsHash([other, halle]));
  assert.notEqual(parkingCamsHash([]), h);
  assert.match(h, /^[0-9a-f]{16}$/);
});

test("Fingerabdruck enthaelt kein Passwort (nur ob eines gesetzt ist)", () => {
  // Das Passwort ist gar nicht Teil der Eingabe; der Text des Fingerabdrucks verraet die Felder nicht.
  const h = parkingCamsHash([halle]);
  assert.ok(!h.includes("kiosk") && !h.includes("10.0.0.20"));
});

test("staleMarkDue: Kamera-Liste hoechstens alle 5 min als veraltet markieren", () => {
  assert.equal(staleMarkDue(0, NOW), true);
  assert.equal(staleMarkDue(NOW - 30_000, NOW), false);
  assert.equal(staleMarkDue(NOW - 299_999, NOW), false);
  assert.equal(staleMarkDue(NOW - 300_000, NOW), true);
});

const snap = (o: Partial<ParkingSnapshotLike> = {}, count = 0, lastError: string | null = null): ParkingSnapshotLike => ({
  trackerOnline: true,
  lots: [{ kioskId: "halle", name: "Halle", ip: "10.0.0.20", mode: "vehicle-zone", count, lastError, zone: [[0, 0], [1, 0], [1, 1]] }],
  ...o,
});

test("parkingReportDue mit dem Standard (30 s): jede Meldung geht hinaus, in jedem Fall", () => {
  const idle = parkingIdleReportMs(undefined);
  assert.equal(idle, PARKING_REPORT_TICK_MS);
  const prev = { at: NOW, key: parkingReportKey(snap()) };
  for (const at of [NOW, NOW - 1, NOW - 29_999, NOW - 30_000, NOW - 3_600_000, 0]) {
    for (const next of [snap(), snap({}, 3), snap({ trackerOnline: false }), snap({}, 0, "Kamera weg")]) {
      assert.equal(parkingReportDue({ ...prev, at }, next, NOW, idle), true);
    }
  }
  assert.equal(parkingReportDue(null, snap(), NOW, idle), true);
  // Auch 0 und Werte unter dem Takt melden jedes Mal.
  assert.equal(parkingReportDue(prev, snap(), NOW, 0), true);
  assert.equal(parkingReportDue(prev, snap(), NOW, 10_000), true);
});

test("parkingReportDue mit laengerem Lebenszeichen: bei Aenderung sofort, sonst nach idleMs", () => {
  const idle = 300_000;
  const prev = { at: NOW - 60_000, key: parkingReportKey(snap()) };
  assert.equal(parkingReportDue(prev, snap(), NOW, idle), false, "gleich nach 60 s");
  assert.equal(parkingReportDue(prev, snap({}, 1), NOW, idle), true, "Zaehlung");
  assert.equal(parkingReportDue(prev, snap({ trackerOnline: false }), NOW, idle), true, "Tracker faellt aus");
  assert.equal(parkingReportDue(prev, snap({}, 0, "Stream weg"), NOW, idle), true, "Fehlertext");
  assert.equal(parkingReportDue(prev, snap({ lots: [] }), NOW, idle), true, "Flaeche entfernt");
  assert.equal(parkingReportDue({ ...prev, at: NOW - 300_000 }, snap(), NOW, idle), true, "Lebenszeichen");
  assert.equal(parkingReportDue(null, snap(), NOW, idle), true, "erste Meldung");
});

test("parkingReportKey: Zeitstempel und Bildrate des Trackers zaehlen nicht", () => {
  const a = snap();
  const b = { ...a, at: "spaeter", lots: a.lots.map((l) => ({ ...l, lastUpdate: 123, fps: 9 })) };
  assert.equal(parkingReportKey(b), parkingReportKey(a));
});

test("trackerFrameDue mit dem Standard (0): Bild bei jedem Lauf, in jedem Fall", () => {
  const idle = parkingFrameIdleMs(undefined);
  assert.equal(idle, 0);
  for (const prevCount of [null, 0, 2]) {
    for (const count of [null, 0, 2]) {
      for (const lastUploadAt of [0, NOW - 30_000, NOW - 1, NOW]) {
        assert.equal(trackerFrameDue({ prevCount, count, lastUploadAt, now: NOW, idleMs: idle }), true);
      }
    }
  }
});

test("trackerFrameDue mit Ruhezeit: bei geaenderter Zaehlung sofort, sonst nach idleMs", () => {
  const g = { prevCount: 0, count: 0, lastUploadAt: NOW - 60_000, now: NOW, idleMs: 300_000 };
  assert.equal(trackerFrameDue(g), false);
  assert.equal(trackerFrameDue({ ...g, count: 1 }), true);
  assert.equal(trackerFrameDue({ ...g, lastUploadAt: NOW - 300_000 }), true);
  assert.equal(trackerFrameDue({ ...g, prevCount: null }), true);
  assert.equal(trackerFrameDue({ ...g, lastUploadAt: 0 }), true);
});

test("Einstellungen: ganze Sekunden 0 bis 3600, ungueltig = Standard", () => {
  assert.equal(parkingIdleReportMs("300"), 300_000);
  assert.equal(parkingIdleReportMs("0"), 0);
  assert.equal(parkingFrameIdleMs(" 120 "), 120_000);
  assert.equal(parkingFrameIdleMs("3600"), 3_600_000);
  for (const v of ["", "abc", "3601", "-5", "1.5", "1e3"]) {
    assert.equal(parkingIdleReportMs(v), 30_000, v);
    assert.equal(parkingFrameIdleMs(v), 0, v);
  }
});

test("lotFromCounter: laufender Videostrom – Zaehlung, Bild darf hoch", () => {
  const lot = lotFromCounter({ count: 2, lastUpdate: NOW, lastError: null, fps: 10.25 }, { count: 1 }, true);
  assert.deepEqual(lot, { count: 2, state: "ok", lastUpdate: NOW, lastError: null, fps: 10.25, upload: true });
  // Aelterer Tracker ohne count: 0 wie bisher.
  assert.equal(lotFromCounter({ lastUpdate: NOW }, null, true).count, 0);
});

test("lotFromCounter: Fehler des Trackers – unbekannt statt alter Zahl, kein Bild", () => {
  const lot = lotFromCounter({ count: 3, lastUpdate: NOW - 600_000, lastError: "RTSP-Stream abgebrochen", fps: 10 }, { count: 3 }, true);
  assert.equal(lot.count, null);
  assert.equal(lot.state, "unbekannt");
  assert.equal(lot.lastError, "RTSP-Stream abgebrochen");
  assert.equal(lot.upload, false);
  // Auch waehrend die Kamera zoomt: der Fehler zaehlt.
  assert.equal(lotFromCounter({ count: 3, lastError: "zone fehlt" }, { count: 3 }, false).count, null);
});

test("lotFromCounter: Tracker fehlt oder kennt die Flaeche nicht – unbekannt statt 0, kein Bild", () => {
  for (const live of [null, undefined]) {
    const lot = lotFromCounter(live, { count: 4 }, true);
    assert.deepEqual(lot, { count: null, state: "unbekannt", lastUpdate: 0, lastError: null, fps: 0, upload: false });
  }
});

test("lotFromCounter: Kamera nicht in Grundstellung – letzte Zaehlung bleibt", () => {
  const live = { count: 0, lastUpdate: NOW, lastError: null, fps: 10 };
  assert.equal(lotFromCounter(live, { count: 2 }, false).count, 2);
  assert.equal(lotFromCounter(live, { count: 2 }, false).state, "ok");
  assert.equal(lotFromCounter(live, { count: null }, false).state, "unbekannt");
  // Ohne vorherige Zaehlung die aktuelle.
  assert.equal(lotFromCounter(live, null, false).count, 0);
});

test("frameLive: Bild gilt als live, solange der Tracker vor hoechstens 2 min ein Bild verarbeitet hat", () => {
  assert.equal(FRAME_LIVE_MAX_AGE_MS, 120_000);
  assert.equal(frameLive(NOW - 1_000, NOW), true);
  assert.equal(frameLive(NOW - 120_000, NOW), true);
  assert.equal(frameLive(NOW - 120_001, NOW), false);
  assert.equal(frameLive(0, NOW), false);
});

test("parkingReportKey: unbekannte Zaehlung ist eine Aenderung", () => {
  const base = { kioskId: "halle", name: "Halle", ip: "10.0.0.20", mode: "vehicle-zone", lastError: null, zone: null };
  const known: ParkingSnapshotLike = { trackerOnline: true, lots: [{ ...base, count: 0 }] };
  const unknown: ParkingSnapshotLike = { trackerOnline: true, lots: [{ ...base, count: null }] };
  assert.notEqual(parkingReportKey(known), parkingReportKey(unknown));
});

test("gateMode: so, wie der Tracker es meldet", () => {
  const counter = (gate: unknown) => ({ count: 0, gate });
  assert.deepEqual(gateMode(counter({ opens: false, reason: "DoorBird öffnen aus, keine Geräte" }), true), {
    opens: false,
    reason: "DoorBird öffnen aus, keine Geräte",
  });
  assert.deepEqual(gateMode(counter({ opens: true, reason: "DoorBird (im Kiosk eingeschaltet) und Geräte 3" }), true), {
    opens: true,
    reason: "DoorBird (im Kiosk eingeschaltet) und Geräte 3",
  });
  // Ohne Grund: laut Tracker; zu lange Gründe gekürzt.
  assert.deepEqual(gateMode(counter({ opens: true }), true), { opens: true, reason: "laut Tracker" });
  assert.equal(gateMode(counter({ opens: false, reason: "x".repeat(500) }), true).reason.length, 200);
});

test("gateMode: fehlt die Angabe (älterer Tracker), ist es unbekannt – nie „zählt nur“", () => {
  const unknown = { opens: null, reason: "Tracker meldet die Tor-Automatik nicht (älterer Stand)" };
  assert.deepEqual(gateMode({}, true), unknown);
  // Nur ein Wahrheitswert zählt als Angabe.
  for (const opens of ["true", 1, null, undefined]) {
    assert.deepEqual(gateMode({ gate: { opens, reason: "x" } }, true), unknown, String(opens));
  }
  assert.deepEqual(gateMode({ gate: "zählt nur" }, true), unknown);
  // Fläche ohne Zählung beim Tracker, Tracker nicht erreichbar.
  assert.deepEqual(gateMode(undefined, true), { opens: null, reason: "Tracker zählt diese Fläche nicht" });
  assert.deepEqual(gateMode({ gate: { opens: false } }, false), { opens: null, reason: "Tracker nicht erreichbar" });
});

test("gateModeLine: eine Zeile je Flaeche, oeffnet, zaehlt nur oder unbekannt", () => {
  assert.equal(
    gateModeLine("Halle", { opens: false, reason: "DoorBird öffnen aus, keine Geräte" }),
    "Parkfläche Halle: zählt nur, Tor-Automatik öffnet nicht (DoorBird öffnen aus, keine Geräte)",
  );
  assert.equal(
    gateModeLine("Halle", { opens: true, reason: "DoorBird (im Kiosk eingeschaltet)" }),
    "Parkfläche Halle: Tor-Automatik öffnet bei Fahrzeug in der Fläche (DoorBird (im Kiosk eingeschaltet))",
  );
  assert.equal(
    gateModeLine("Halle", gateMode({}, true)),
    "Parkfläche Halle: Tor-Automatik unbekannt (Tracker meldet die Tor-Automatik nicht (älterer Stand))",
  );
});
