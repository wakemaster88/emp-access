import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSEUP_GAP_MS,
  CLOSEUP_GAP_ZONE_MS,
  HOME_SETTLE_MS,
  closeUpBlocked,
  followBlocked,
  isAtHome,
  isCentered,
  isZoneCamera,
  magnificationAt,
  maxCenterGain,
  newMotionState,
  opticalFactor,
  planCloseUp,
  posForMagnification,
  readTrackingCfg,
} from "./camera-motion-rules.js";

const MID = { x: 0.45, y: 0.375, w: 0.1, h: 0.25 };
const WIDE = { pos: 0, min: 0, max: 33 };

test("Zoomfaktor je Modell, unbekannt vorsichtig 3", () => {
  assert.equal(opticalFactor("RLC-811A"), 5);
  assert.equal(opticalFactor("RLC-823A 16X"), 16);
  assert.equal(opticalFactor("RLC-823S1"), 3);
  assert.equal(opticalFactor(null), 3);
});

test("Zoom-Position und Vergrößerung linear", () => {
  assert.equal(magnificationAt(0, 0, 33, 5), 1);
  assert.equal(magnificationAt(33, 0, 33, 5), 5);
  assert.equal(posForMagnification(3, 0, 33, 5), 17);
  assert.equal(posForMagnification(9, 0, 33, 5), 33);
  assert.equal(posForMagnification(1, 0, 33, 5), 0);
});

test("Zoom zur Mitte: Person am Rand verträgt keinen Zoom", () => {
  assert.ok(maxCenterGain(MID) > 3);
  assert.ok(maxCenterGain({ x: 0.9, y: 0.4, w: 0.08, h: 0.2 }) < 1);
});

test("Nahaufnahme: Person in der Mitte füllt 60 % der Höhe", () => {
  const p = planCloseUp([MID], WIDE, 5)!;
  assert.ok(Math.abs(p.gain - 2.4) < 1e-9);
  assert.equal(p.pos, 12);
});

test("Nahaufnahme: kleine Person bei 16-fach, begrenzt durch den Bildrand", () => {
  const p = planCloseUp([{ x: 0.49, y: 0.47, w: 0.02, h: 0.05 }], WIDE, 16)!;
  // gewünscht wären 12-fach, der Rand erlaubt nur 0,5 / 0,06 ≈ 8,3
  assert.ok(Math.abs(p.gain - 0.5 / 0.06) < 1e-6);
});

test("Nahaufnahme: Gruppe passt nicht, dann die größte Person, die passt", () => {
  const edge = { x: 0.85, y: 0.3, w: 0.12, h: 0.4 };
  const mid = { x: 0.47, y: 0.42, w: 0.06, h: 0.15 };
  const p = planCloseUp([edge, mid], WIDE, 5)!;
  assert.deepEqual(p.box, mid);
});

test("Nahaufnahme: schon gezoomt oder ohne Personen nichts zu tun", () => {
  assert.equal(planCloseUp([MID], { pos: 33, min: 0, max: 33 }, 5), null);
  assert.equal(planCloseUp([], WIDE, 5), null);
});

test("Person nach dem Nachführen in der Bildmitte", () => {
  assert.equal(isCentered(MID), true);
  assert.equal(isCentered({ x: 0.05, y: 0.4, w: 0.1, h: 0.2 }), false);
});

test("Tracking-Schalter: bSmartTrack vor aiTrack, Personen als Zielart", () => {
  assert.deepEqual(readTrackingCfg({ bSmartTrack: 0, aiTrack: 3 }), { key: "bSmartTrack", on: false, peopleOff: false });
  assert.deepEqual(readTrackingCfg({ aiTrack: 1 }), { key: "aiTrack", on: true, peopleOff: false });
  assert.deepEqual(readTrackingCfg({ aiTrack: 0, trackType: { people: 0, vehicle: 1 } }), {
    key: "aiTrack",
    on: false,
    peopleOff: true,
  });
  assert.equal(readTrackingCfg({}), null);
});

test("Zonen-Kamera: Kennzeichen, Halteverbot, Lieferdienste oder Parkfläche", () => {
  const none = new Set<string>();
  assert.equal(isZoneCamera({ host: "a", vehicleDetection: false }, none), false);
  assert.equal(isZoneCamera({ host: "a", vehicleDetection: true }, none), true);
  assert.equal(isZoneCamera({ host: "a", vehicleDetection: false, noParkDetection: true }, none), true);
  assert.equal(isZoneCamera({ host: "a", vehicleDetection: false, deliveryMode: "NOTIFY" }, none), true);
  assert.equal(isZoneCamera({ host: "192.168.30.12", vehicleDetection: false }, new Set(["192.168.30.12"])), true);
});

test("Grundstellung: nicht während Folgen oder Nahaufnahme, erst nach dem Fokus", () => {
  const st = newMotionState(0);
  assert.equal(isAtHome(st, 0), true);
  st.following = true;
  assert.equal(isAtHome(st, 0), false);
  st.following = false;
  st.homeAt = 1_000;
  assert.equal(isAtHome(st, 1_000 + HOME_SETTLE_MS - 1), false);
  assert.equal(isAtHome(st, 1_000 + HOME_SETTLE_MS), true);
});

test("Folgen: nur Schwenk-Kameras ohne Zonen, Hand und Regel gehen vor", () => {
  const cam = { pan: true, zoom: false, zone: false };
  const st = newMotionState(0);
  assert.equal(followBlocked(st, 0, cam), null);
  assert.equal(followBlocked(st, 0, { ...cam, pan: false }), "kein Schwenkkopf");
  assert.equal(followBlocked(st, 0, { ...cam, zone: true }), "Zonen-Kamera");
  st.hold = { by: "hand", until: 1_000 };
  assert.equal(followBlocked(st, 999, cam), "Handsteuerung");
  assert.equal(followBlocked(st, 1_000, cam), null);
  st.followCooldownUntil = 2_000;
  assert.equal(followBlocked(st, 1_500, cam), "Pause nach dem Folgen");
});

test("Nahaufnahme: Abstand 30 s, an Zonen-Kameras 2 min und nie bei Fahrzeug", () => {
  const cam = { pan: false, zoom: true, zone: false };
  const zone = { ...cam, zone: true };
  const st = newMotionState(0);
  st.lastCloseUpAt = 0;
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_MS - 1, cam, false), "letzte Nahaufnahme zu kurz her");
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_MS, cam, false), null);
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_MS, zone, false), "letzte Nahaufnahme zu kurz her");
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_ZONE_MS, zone, false), null);
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_ZONE_MS, zone, true), "Fahrzeug an der Zonen-Kamera");
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_ZONE_MS, { ...cam, zoom: false }, false), "kein Zoom");
});
