import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHRINK_MIN_BYTES,
  motionPreviewSettings,
  personSnapshotSettings,
  shrinkNeeded,
  sipsArgs,
  type JpegSettings,
} from "./image-rules.js";

test("Sichtungsbild einer Person: Standard 1280 px und Qualität 75", () => {
  assert.deepEqual(personSnapshotSettings({}), { maxPx: 1280, quality: 75 });
});

test("Sichtungsbild einstellbar: 640 bis 3840 px, Qualität 50 bis 95", () => {
  assert.deepEqual(personSnapshotSettings({ HUB_PERSON_SNAPSHOT_MAX_PX: "1600", HUB_PERSON_JPEG_QUALITY: "82" }), { maxPx: 1600, quality: 82 });
  assert.deepEqual(personSnapshotSettings({ HUB_PERSON_SNAPSHOT_MAX_PX: " 640 ", HUB_PERSON_JPEG_QUALITY: "50" }), { maxPx: 640, quality: 50 });
  assert.deepEqual(personSnapshotSettings({ HUB_PERSON_SNAPSHOT_MAX_PX: "3840", HUB_PERSON_JPEG_QUALITY: "95" }), { maxPx: 3840, quality: 95 });
});

test("Ungültige Werte ergeben den Standard", () => {
  for (const v of ["", "abc", "639", "3841", "1280.5", "-1280", "1e3", "0"]) {
    assert.equal(personSnapshotSettings({ HUB_PERSON_SNAPSHOT_MAX_PX: v }).maxPx, 1280, v);
  }
  for (const v of ["", "hoch", "49", "96", "75.5", "-75", "100"]) {
    assert.equal(personSnapshotSettings({ HUB_PERSON_JPEG_QUALITY: v }).quality, 75, v);
  }
});

test("sips bekommt Kantenlänge und Qualität", () => {
  assert.deepEqual(sipsArgs(1280, 75, "/tmp/in.jpg", "/tmp/out.jpg"), [
    "-Z",
    "1280",
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "75",
    "/tmp/in.jpg",
    "--out",
    "/tmp/out.jpg",
  ]);
});

const DISPLAY: JpegSettings = { maxPx: 1280, quality: 82 };

test("Vorschaubild bei reiner Bewegung: Standard 960 px und Qualität 70, immer verkleinert", () => {
  assert.deepEqual(motionPreviewSettings({}, DISPLAY), { maxPx: 960, quality: 70, minBytes: 0 });
});

test("Vorschaubild: 0 ergibt die Größe aller übrigen Anzeige-Bilder, sonst 320 bis 1280 px", () => {
  assert.deepEqual(motionPreviewSettings({ HUB_MOTION_SNAPSHOT_MAX_PX: "0" }, DISPLAY), DISPLAY);
  assert.deepEqual(motionPreviewSettings({ HUB_MOTION_SNAPSHOT_MAX_PX: " 0 " }, DISPLAY), DISPLAY);
  assert.deepEqual(motionPreviewSettings({ HUB_MOTION_SNAPSHOT_MAX_PX: "640" }, DISPLAY), { maxPx: 640, quality: 70, minBytes: 0 });
  assert.deepEqual(motionPreviewSettings({ HUB_MOTION_SNAPSHOT_MAX_PX: "320" }, DISPLAY), { maxPx: 320, quality: 70, minBytes: 0 });
  assert.deepEqual(motionPreviewSettings({ HUB_MOTION_SNAPSHOT_MAX_PX: "1280" }, DISPLAY), { maxPx: 1280, quality: 70, minBytes: 0 });
});

test("Vorschaubild: ungültige Werte ergeben den Standard", () => {
  for (const v of ["", "abc", "319", "1281", "3840", "960.5", "-960", "1e3"]) {
    assert.deepEqual(motionPreviewSettings({ HUB_MOTION_SNAPSHOT_MAX_PX: v }, DISPLAY), { maxPx: 960, quality: 70, minBytes: 0 }, v);
  }
});

test("Verkleinern: unter 200 KB nur das Vorschaubild, alle anderen Bildwege wie bisher", () => {
  assert.equal(SHRINK_MIN_BYTES, 200 * 1024);
  // Ohne Angabe (Person, Fahrzeug, Halteverbot, Scan, Abruf aus der Cloud): wie bisher ab 200 KB.
  assert.equal(shrinkNeeded(200 * 1024 - 1), false);
  assert.equal(shrinkNeeded(200 * 1024), true);
  assert.equal(shrinkNeeded(3_000_000), true);
  // Dunkles Nachtbild einer 4K-Kamera mit 180 KB: das Vorschaubild kommt trotzdem mit 960 px.
  const preview = motionPreviewSettings({}, DISPLAY);
  assert.equal(shrinkNeeded(180 * 1024, preview.minBytes), true);
  assert.equal(shrinkNeeded(13, preview.minBytes), true);
  // HUB_MOTION_SNAPSHOT_MAX_PX=0: Groesse und Schranke wie vor dem 25.11.2026.
  assert.equal(shrinkNeeded(180 * 1024, motionPreviewSettings({ HUB_MOTION_SNAPSHOT_MAX_PX: "0" }, DISPLAY).minBytes), false);
  assert.equal(shrinkNeeded(180 * 1024, DISPLAY.minBytes), false);
});
