import { test } from "node:test";
import assert from "node:assert/strict";
import { personSnapshotSettings, sipsArgs } from "./image-rules.js";

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
