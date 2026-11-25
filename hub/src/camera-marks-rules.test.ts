import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCameraMarks, serializeCameraMarks, unknownMarks } from "./camera-marks-rules.js";

const now = Date.parse("2026-11-25T18:00:00Z");

test("Merkliste: gespeicherte Eintraege werden gelesen, wie sie geschrieben wurden", () => {
  const marks = new Map([
    [3, Date.parse("2026-11-25T17:59:40Z")],
    [7, Date.parse("2026-11-24T22:15:00Z")],
  ]);
  const raw = serializeCameraMarks(marks);
  assert.equal(
    raw,
    '{"cameras":[{"cameraId":3,"at":"2026-11-25T17:59:40.000Z"},{"cameraId":7,"at":"2026-11-24T22:15:00.000Z"}]}'
  );
  assert.deepEqual(parseCameraMarks(raw, now), marks);
  assert.deepEqual(parseCameraMarks(serializeCameraMarks(new Map()), now), new Map());
});

test("Merkliste: kaputte oder fremde Inhalte gelten als leer", () => {
  for (const raw of [
    "",
    "null",
    "{}",
    "[]",
    '{"cameras":{"3":"2026-11-25T17:59:40Z"}}',
    '{"cameras":[{"cameraId":3,"at":"2026-11-25T17:5', // abgeschnitten
  ]) {
    assert.deepEqual(parseCameraMarks(raw, now), new Map(), raw);
  }
});

test("Merkliste: ein unlesbarer Eintrag entfaellt, die anderen bleiben", () => {
  const raw = JSON.stringify({
    cameras: [
      null,
      "3",
      { cameraId: "3", at: "2026-11-25T17:00:00Z" },
      { cameraId: 0, at: "2026-11-25T17:00:00Z" },
      { cameraId: 2.5, at: "2026-11-25T17:00:00Z" },
      { cameraId: 4, at: "gestern" },
      { cameraId: 5, at: 1764000000000 },
      { cameraId: 6 },
      { cameraId: 9, at: "2026-11-25T17:30:00Z" },
    ],
  });
  assert.deepEqual(parseCameraMarks(raw, now), new Map([[9, Date.parse("2026-11-25T17:30:00Z")]]));
});

test("Merkliste: eine Zeit in der Zukunft entfaellt, eine halbe Minute Uhrenabweichung nicht", () => {
  const raw = JSON.stringify({
    cameras: [
      { cameraId: 3, at: "2026-11-25T18:05:00Z" },
      { cameraId: 7, at: "2026-11-25T18:00:30Z" },
    ],
  });
  assert.deepEqual(parseCameraMarks(raw, now), new Map([[7, Date.parse("2026-11-25T18:00:30Z")]]));
});

test("Merkliste: steht eine Kamera doppelt da, gilt ihr letzter Eintrag", () => {
  const raw = JSON.stringify({
    cameras: [
      { cameraId: 3, at: "2026-11-25T17:00:00Z" },
      { cameraId: 3, at: "2026-11-25T17:40:00Z" },
    ],
  });
  assert.deepEqual(parseCameraMarks(raw, now), new Map([[3, Date.parse("2026-11-25T17:40:00Z")]]));
});

test("Merkliste: Eintraege von Kameras, die nicht in der Kamera-Liste stehen, entfallen", () => {
  const marks = parseCameraMarks(
    JSON.stringify({
      cameras: [
        { cameraId: 3, at: "2026-11-25T17:00:00Z" },
        { cameraId: 7, at: "2026-11-25T09:00:00Z" },
        { cameraId: 12, at: "2026-11-14T08:00:00Z" },
      ],
    }),
    now
  );
  assert.deepEqual(unknownMarks(marks, new Set([3, 4, 7])), [12]);
  assert.deepEqual(unknownMarks(marks, new Set([3, 7, 12])), []);
  assert.deepEqual(unknownMarks(marks, new Set()), [3, 7, 12]);
  assert.deepEqual(unknownMarks(new Map(), new Set([3])), []);
});
