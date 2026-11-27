import assert from "node:assert/strict";
import { test } from "node:test";
import {
  liveModeHint,
  liveModeUpdateData,
  liveTileShown,
  parseLiveMode,
  previewAllowed,
  previewWriteData,
  readLiveMode,
  shownSnapshotAt,
} from "./camera-live-mode";

test("parseLiveMode: leer und AUTO werden null, CLICK und OFF bleiben, Rest ist ungültig", () => {
  assert.equal(parseLiveMode(null), null);
  assert.equal(parseLiveMode(""), null);
  assert.equal(parseLiveMode("AUTO"), null);
  assert.equal(parseLiveMode("CLICK"), "CLICK");
  assert.equal(parseLiveMode("OFF"), "OFF");
  for (const bad of ["click", "off", "AN", "TAP", 1, true, {}, undefined]) {
    assert.equal(parseLiveMode(bad), "invalid", String(bad));
  }
});

test("readLiveMode: unbekannte Werte gelten wie nur auf Tippen", () => {
  assert.equal(readLiveMode(null), "AUTO");
  assert.equal(readLiveMode(undefined), "AUTO");
  assert.equal(readLiveMode(""), "AUTO");
  assert.equal(readLiveMode("AUTO"), "AUTO");
  assert.equal(readLiveMode(" off "), "OFF");
  assert.equal(readLiveMode("CLICK"), "CLICK");
  assert.equal(readLiveMode("NACHTS"), "CLICK");
});

test("Vorschaubild nur bei automatisch, Kachel nur nicht bei aus", () => {
  assert.equal(previewAllowed(null), true);
  assert.equal(previewAllowed("AUTO"), true);
  assert.equal(previewAllowed("CLICK"), false);
  assert.equal(previewAllowed("OFF"), false);
  assert.equal(previewAllowed("etwas"), false);
  assert.equal(liveTileShown(null), true);
  assert.equal(liveTileShown("CLICK"), true);
  assert.equal(liveTileShown("OFF"), false);
});

test("Umstellen auf nur auf Tippen oder aus löscht das Vorschaubild im selben Update", () => {
  assert.deepEqual(liveModeUpdateData(null), { liveMode: null });
  assert.deepEqual(liveModeUpdateData("CLICK"), { liveMode: "CLICK", snapshot: null, snapshotAt: null });
  assert.deepEqual(liveModeUpdateData("OFF"), { liveMode: "OFF", snapshot: null, snapshotAt: null });
});

test("Eintreffendes Bild: zuletzt gesehen immer, Vorschaubild nur bei automatisch", () => {
  const at = new Date("2026-11-27T10:00:00Z");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
  assert.deepEqual(previewWriteData(null, jpeg, at, true), { snapshot: jpeg, snapshotAt: at, lastSeenAt: at });
  assert.deepEqual(previewWriteData(null, jpeg, at, false), { snapshot: jpeg, snapshotAt: at });
  assert.deepEqual(previewWriteData("CLICK", jpeg, at, true), { lastSeenAt: at });
  assert.deepEqual(previewWriteData("OFF", jpeg, at, false), {});
});

test("Oberfläche bekommt den Zeitpunkt des Vorschaubilds nur bei automatisch", () => {
  const at = "2026-11-27T10:00:00.000Z";
  assert.equal(shownSnapshotAt(null, at), at);
  assert.equal(shownSnapshotAt("CLICK", at), null);
  assert.equal(shownSnapshotAt("OFF", at), null);
  assert.equal(shownSnapshotAt(null, null), null);
});

test("Hinweis im Formular je Wert, ohne Gedankenstrich", () => {
  assert.match(liveModeHint("CLICK"), /erst auf Tippen/);
  assert.equal(liveModeHint("OFF"), "Keine Kachel, kein Livebild, kein Vorschaubild.");
  assert.match(liveModeHint(""), /von selbst/);
  for (const v of ["", "CLICK", "OFF"]) assert.ok(!/[–—]/.test(liveModeHint(v)));
});
