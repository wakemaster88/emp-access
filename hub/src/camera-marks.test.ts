import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CameraMarks } from "./camera-marks.js";

/** Leeres Verzeichnis fuer einen Test; die Datei liegt wie beim Hub in einem Unterordner, den es noch nicht gibt. */
function tmpFile(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "camera-marks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, ".cache", "marks.json");
}

// Gelesen wird gegen die echte Uhr (eine Zeit in der Zukunft entfaellt): vor 20 s.
const at = Date.now() - 20_000;

test("Merkliste auf der Platte: was gemerkt ist, liest der naechste Prozess", async (t) => {
  const file = tmpFile(t);
  const first = new CameraMarks(file);
  assert.equal(first.get(3), null);
  await first.set(3, at);
  await first.set(7, at + 5_000);
  assert.equal(first.get(3), at);

  const next = new CameraMarks(file);
  assert.deepEqual(next.entries(), [[3, at], [7, at + 5_000]]);
  // Nur die Datei selbst bleibt liegen, keine Zwischendatei.
  assert.deepEqual(readdirSync(path.dirname(file)), ["marks.json"]);
});

test("Merkliste auf der Platte: geloescht wird nur der Eintrag, der gemeint ist", async (t) => {
  const file = tmpFile(t);
  const marks = new CameraMarks(file);
  await marks.set(3, at);
  // Inzwischen neu gemerkt: Der alte Zeitpunkt loescht den neuen Eintrag nicht.
  await marks.set(3, at + 60_000);
  await marks.delete(3, at);
  assert.equal(new CameraMarks(file).get(3), at + 60_000);
  await marks.delete(3, at + 60_000);
  assert.equal(new CameraMarks(file).get(3), null);
  // Ohne Zeitpunkt: der Eintrag der Kamera, wie er ist.
  await marks.set(7, at);
  await marks.delete(7);
  await marks.delete(9); // nie gemerkt
  assert.deepEqual(new CameraMarks(file).entries(), []);
});

test("Merkliste auf der Platte: schnell nacheinander gemerkt und geloescht, am Ende steht der letzte Stand", async (t) => {
  const file = tmpFile(t);
  const marks = new CameraMarks(file);
  const writes = [marks.set(3, at), marks.set(7, at), marks.delete(3), marks.set(9, at + 1_000)];
  await Promise.all(writes);
  assert.deepEqual(new CameraMarks(file).entries(), [[7, at], [9, at + 1_000]]);
  assert.deepEqual(readdirSync(path.dirname(file)), ["marks.json"]);
});

test("Merkliste auf der Platte: eine kaputte Datei gilt als leer und wird beim naechsten Merken ersetzt", async (t) => {
  const file = tmpFile(t);
  const seed = new CameraMarks(file);
  await seed.set(3, at); // legt den Ordner an
  writeFileSync(file, '{"cameras":[{"cameraId":3,"at":"2026-11-25T17:5');
  const marks = new CameraMarks(file);
  assert.deepEqual(marks.entries(), []);
  await marks.set(7, at);
  assert.deepEqual(new CameraMarks(file).entries(), [[7, at]]);
});

test("Merkliste auf der Platte: laesst sich nicht schreiben, laeuft der Hub ohne sie weiter", async (t) => {
  const file = tmpFile(t);
  // Wo der Ordner hin soll, liegt eine Datei: Schreiben scheitert.
  writeFileSync(path.dirname(file), "");
  const marks = new CameraMarks(file);
  await marks.set(3, at);
  assert.equal(marks.get(3), at);
  assert.equal(new CameraMarks(file).get(3), null);
});

test("Merkliste auf der Platte: Kameras, die es nicht mehr gibt, entfallen – geschrieben wird nur dann", async (t) => {
  const file = tmpFile(t);
  const marks = new CameraMarks(file);
  await marks.set(3, at);
  await marks.set(12, at - 3_600_000);
  const before = statSync(file).mtimeMs;
  // Alle noch in der Kamera-Liste: Die Datei bleibt, wie sie ist.
  await marks.keepOnly(new Set([3, 7, 12]));
  assert.equal(statSync(file).mtimeMs, before);
  assert.deepEqual(new CameraMarks(file).entries(), [[3, at], [12, at - 3_600_000]]);
  // Kamera 12 ist aus der Liste entfernt.
  await marks.keepOnly(new Set([3, 7]));
  assert.equal(marks.get(12), null);
  assert.deepEqual(new CameraMarks(file).entries(), [[3, at]]);
});
