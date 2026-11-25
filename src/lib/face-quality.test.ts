import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_FACE_QUALITY, parseFaceQuality } from "./face-quality";

const q = (s: string) => parseFaceQuality(new URLSearchParams(s));

test("Güte-Angaben eines Hubs werden gelesen", () => {
  assert.deepEqual(q("cameraId=3&faceSize=96.5&faceUpscaled=0&faceDetScore=0.712&faceMargin=0.1534"), {
    faceSize: 96.5,
    faceUpscaled: false,
    faceDetScore: 0.712,
    faceMargin: 0.1534,
  });
  assert.equal(q("faceUpscaled=1").faceUpscaled, true);
  assert.equal(q("faceUpscaled=true").faceUpscaled, true);
  assert.equal(q("faceUpscaled=false").faceUpscaled, false);
});

test("Älterer Hub ohne Angaben: alles null, wie bisher", () => {
  assert.deepEqual(q("cameraId=3&listedPersonId=7&matchScore=0.6123&matchMethod=FACE_EMBEDDING"), NO_FACE_QUALITY);
});

test("Werte außerhalb des Bereichs oder unlesbar gelten als fehlend", () => {
  assert.deepEqual(q("faceSize=0&faceUpscaled=ja&faceDetScore=1.2&faceMargin=-0.1"), NO_FACE_QUALITY);
  assert.deepEqual(q("faceSize=&faceUpscaled=&faceDetScore=&faceMargin="), NO_FACE_QUALITY);
  assert.deepEqual(q("faceSize=abc&faceDetScore=NaN&faceMargin=Infinity"), NO_FACE_QUALITY);
  assert.equal(q("faceSize=90000").faceSize, null);
  // Nur einfache Dezimalzahlen, wie der Hub sie schickt.
  assert.deepEqual(q("faceSize=0x40&faceDetScore=1e-1&faceMargin=%200.2"), NO_FACE_QUALITY);
  // Jede Angabe zählt für sich: eine unlesbare macht die anderen nicht ungültig.
  assert.deepEqual(q("faceSize=80&faceUpscaled=2&faceDetScore=0.9&faceMargin=0.2"), {
    faceSize: 80,
    faceUpscaled: null,
    faceDetScore: 0.9,
    faceMargin: 0.2,
  });
  // Ränder gehören dazu.
  assert.equal(q("faceDetScore=0").faceDetScore, 0);
  assert.equal(q("faceDetScore=1").faceDetScore, 1);
  assert.equal(q("faceMargin=0").faceMargin, 0);
});
