import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHRINK_MIN_BYTES,
  jpegSize,
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

/** JPEG-Kopf wie von Kamera oder ffmpeg: APP0, DQT, optional Füllbytes, SOF, SOS. */
function jpegHead(width: number, height: number, sof = 0xc0, fill = 0): Buffer {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  return Buffer.from([
    0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, new Array(65).fill(1)),
    ...new Array(fill).fill(0xff),
    ...seg(sof, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    0x12, 0x34, 0xff, 0xd9,
  ]);
}

test("jpegSize: Breite und Höhe aus dem SOF-Kopf", () => {
  assert.deepEqual(jpegSize(jpegHead(3840, 2160)), { width: 3840, height: 2160 });
  assert.deepEqual(jpegSize(jpegHead(2560, 1440, 0xc2)), { width: 2560, height: 1440 });
  assert.deepEqual(jpegSize(jpegHead(640, 360, 0xc0, 3)), { width: 640, height: 360 });
});

test("jpegSize: kein JPEG, abgeschnitten oder ohne SOF – null", () => {
  assert.equal(jpegSize(Buffer.alloc(0)), null);
  assert.equal(jpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(jpegSize(jpegHead(3840, 2160).subarray(0, 30)), null);
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])), null);
  assert.equal(jpegSize(jpegHead(0, 2160)), null);
  // DHT (0xC4) ist kein SOF, trotz Nummer im Bereich.
  const dht = Buffer.from([0xff, 0xd8, 0xff, 0xc4, 0, 7, 0, 1, 0, 1, 0, 0xff, 0xd9]);
  assert.equal(jpegSize(dht), null);
});
