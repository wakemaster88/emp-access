import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSEUP_CACHE_MS,
  CLOSEUP_EMPTY_CACHE_MS,
  CLOSEUP_GAP_MS,
  CLOSEUP_GAP_ZONE_MS,
  CLOSEUP_SKIP_PAUSE_MS,
  HOME_SETTLE_MS,
  ZOOM_RETURN_RETRIES,
  closeUpBlocked,
  closeUpCacheUsable,
  followAlwaysOn,
  followBlocked,
  followRoomBlocked,
  isAtHome,
  isCentered,
  isZoneCamera,
  magnificationAt,
  maxCenterGain,
  newMotionState,
  opticalFactor,
  opticalWorth,
  planCloseUp,
  posForMagnification,
  readTrackingCfg,
  roomLabel,
  shouldRestoreZoom,
  zoomReturnGivenUp,
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

test("Nahaufnahme: keine neue, solange die Rückfahrt des Zooms aussteht", () => {
  const cam = { pan: false, zoom: true, zone: false };
  const st = newMotionState(0);
  assert.equal(closeUpBlocked(st, 0, cam, false, true), "Zoom noch nicht zurück");
  assert.equal(closeUpBlocked(st, 0, cam, false, false), null);
  // Hand und Regel gehen als Grund vor.
  st.hold = { by: "hand", until: 1_000 };
  assert.equal(closeUpBlocked(st, 0, cam, false, true), "Handsteuerung");
});

test("Zoom nach Handsteuerung: zurück nur, wenn er noch steht, wo die Automatik ihn hingestellt hat", () => {
  // Unverändert auf der Position der Automatik: zurück in die Ausgangsstellung.
  assert.equal(shouldRestoreZoom(12, 12, 0), true);
  // Von Hand weiter herein- oder herausgezoomt: die Einstellung bleibt.
  assert.equal(shouldRestoreZoom(16, 12, 0), false);
  assert.equal(shouldRestoreZoom(8, 12, 0), false);
  // Steht schon in der Ausgangsstellung: nichts zu tun.
  assert.equal(shouldRestoreZoom(0, 12, 0), false);
  // Ausgangsstellung war nicht Weitwinkel.
  assert.equal(shouldRestoreZoom(20, 20, 6), true);
  assert.equal(shouldRestoreZoom(6, 20, 6), false);
});

test("Rückfahrt des Zooms: nach dem ersten Fehlversuch noch zehn weitere, dann aufgeben", () => {
  assert.equal(ZOOM_RETURN_RETRIES, 10);
  assert.equal(zoomReturnGivenUp(1), false);
  assert.equal(zoomReturnGivenUp(ZOOM_RETURN_RETRIES), false);
  assert.equal(zoomReturnGivenUp(ZOOM_RETURN_RETRIES + 1), true);
});

test("Zoom für die Gesichtserkennung nur, wenn das Gesicht danach mindestens 64 px groß ist", () => {
  // Mini-Gesicht, kleiner Faktor: bleibt zu klein.
  assert.equal(opticalWorth(30, 1.5), false);
  // 40 px mal 2: 80 px.
  assert.equal(opticalWorth(40, 2.0), true);
  assert.equal(opticalWorth(32, 2.0), true);
  assert.equal(opticalWorth(31, 2.0), false);
  // Ohne Gesicht erst ab Faktor 2.
  assert.equal(opticalWorth(null, 1.5), false);
  assert.equal(opticalWorth(null, 2.0), true);
  assert.equal(opticalWorth(0, 2.4), true);
  // Direkt erkannte Gesichter (an 4K-Kameras ab 96 px): Größe mal Faktor, wie jedes andere.
  assert.equal(opticalWorth(100, 2.0), true);
  assert.equal(opticalWorth(96, 1.3), true);
  assert.equal(opticalWorth(64, 1.5), true);
  // Knapp: 50 × 1,3 = 65 px reicht, 49 × 1,3 = 63,7 px nicht.
  assert.equal(opticalWorth(50, 1.3), true);
  assert.equal(opticalWorth(49, 1.3), false);
  // Kein Gewinn, keine Fahrt.
  assert.equal(opticalWorth(80, 1), false);
  assert.equal(opticalWorth(null, Number.NaN), false);
});

test("Nach einem Verzicht ohne Fahrt: 15 s Pause, auch an Zonen-Kameras", () => {
  assert.equal(CLOSEUP_SKIP_PAUSE_MS, 15_000);
  for (const zone of [false, true]) {
    const cam = { pan: false, zoom: true, zone };
    const st = newMotionState(0);
    st.skipUntil = 15_000;
    assert.equal(closeUpBlocked(st, 14_999, cam, false), "letzter Versuch ohne Fahrt zu kurz her");
    assert.equal(closeUpBlocked(st, 15_000, cam, false), null);
  }
});

test("Verzicht nur wegen des Gesichts sperrt die Gesichtserkennung, nicht den Wächter", () => {
  const cam = { pan: false, zoom: true, zone: true };
  const st = newMotionState(0);
  st.faceSkipUntil = CLOSEUP_GAP_ZONE_MS;
  assert.equal(closeUpBlocked(st, 60_000, cam, false, false, true), "Fahrt lohnte für das Gesicht eben nicht");
  assert.equal(closeUpBlocked(st, 60_000, cam, false, false, false), null);
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_ZONE_MS, cam, false, false, true), null);
});

test("Zwischenspeicher: Bild 45 s, leeres Ergebnis 10 s, Verzicht wegen des Gesichts nicht für den Wächter", () => {
  assert.equal(closeUpCacheUsable({ ok: true, faceSkip: false, ageMs: CLOSEUP_CACHE_MS - 1 }, false), true);
  assert.equal(closeUpCacheUsable({ ok: true, faceSkip: false, ageMs: CLOSEUP_CACHE_MS }, true), false);
  assert.equal(CLOSEUP_EMPTY_CACHE_MS, 10_000);
  assert.equal(closeUpCacheUsable({ ok: false, faceSkip: false, ageMs: 9_999 }, false), true);
  assert.equal(closeUpCacheUsable({ ok: false, faceSkip: false, ageMs: 10_000 }, true), false);
  // Die Gesichtserkennung hat verzichtet: der Wächter plant selbst, die Gesichtserkennung nicht neu.
  assert.equal(closeUpCacheUsable({ ok: false, faceSkip: true, ageMs: 1_000 }, false), false);
  assert.equal(closeUpCacheUsable({ ok: false, faceSkip: true, ageMs: 1_000 }, true), true);
});

test("Folgen nur bei geschlossenem Raum; unbekannt: nur im Nachtfenster des Wächters", () => {
  const cam = { pan: true, zoom: false, zone: false };
  const st = newMotionState(0);
  const room = { closed: true as boolean | null, hour: 14, nightWindow: "22-6", always: false };
  // Raum offen: nein.
  assert.equal(followBlocked(st, 0, cam, { ...room, closed: false }), "Raum offen");
  // Geschlossen: ja, auch am Tag.
  assert.equal(followBlocked(st, 0, cam, room), null);
  // Unbekannt (keine Raumdaten, Kamera ohne Raum, Assistent aus): um 14 Uhr nein, um 23 Uhr ja.
  assert.equal(followBlocked(st, 0, cam, { ...room, closed: null, hour: 14 }), "Raum unbekannt, außerhalb des Nachtfensters");
  assert.equal(followBlocked(st, 0, cam, { ...room, closed: null, hour: 23 }), null);
  assert.equal(followBlocked(st, 0, cam, { ...room, closed: null, hour: 5 }), null);
  // Stunde nicht lesbar: kein Nachtfenster.
  assert.equal(followRoomBlocked({ ...room, closed: null, hour: Number.NaN }), "Raum unbekannt, außerhalb des Nachtfensters");
  // HUB_FOLLOW_ALWAYS: wie früher.
  assert.equal(followBlocked(st, 0, cam, { ...room, closed: false, always: true }), null);
  // Ohne Betriebszustand (Nahaufnahme des Wächters) zählt er nicht.
  assert.equal(followBlocked(st, 0, cam), null);
  // Die übrigen Gründe gehen vor.
  assert.equal(followBlocked(st, 0, { ...cam, pan: false }, { ...room, closed: false }), "kein Schwenkkopf");
  st.hold = { by: "hand", until: 1_000 };
  assert.equal(followBlocked(st, 0, cam, { ...room, closed: false }), "Handsteuerung");
});

test("Betriebszustand im Zähler: offen, geschlossen, unbekannt", () => {
  assert.equal(roomLabel(true), "geschlossen");
  assert.equal(roomLabel(false), "offen");
  assert.equal(roomLabel(null), "unbekannt");
});

test("HUB_FOLLOW_ALWAYS: 1, true, ja, on stellen das frühere Folgen her", () => {
  for (const v of ["1", "true", "ja", "on", " ON ", "True"]) assert.equal(followAlwaysOn(v), true, v);
  for (const v of [undefined, "", "0", "off", "nein", "false", "yes", "immer"]) assert.equal(followAlwaysOn(v), false, String(v));
});
