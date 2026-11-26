import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCENE_RETURN_KEEP_MS,
  SCENE_RETURN_RETRY_MS,
  dueSceneReturns,
  parseSceneReturns,
  sceneReturnCamera,
  sceneReturnsToSave,
  type SavedSceneReturn,
} from "./scene-return-rules.js";

const T = Date.parse("2026-11-28T18:00:00.000Z");
const entry = (extra: Partial<SavedSceneReturn> = {}): SavedSceneReturn => ({
  cameraId: 4,
  dueAt: T,
  presetId: 2,
  restoreTrack: true,
  savedAt: T - 60_000,
  ...extra,
});

test("dueSceneReturns: abgelaufen sofort, spaeter neu ansetzen, aelter als 24 h verwerfen", () => {
  const due = entry({ cameraId: 1, dueAt: T - 5_000 });
  const exactly = entry({ cameraId: 2, dueAt: T });
  const later = entry({ cameraId: 3, dueAt: T + 30_000 });
  const old = entry({ cameraId: 5, dueAt: T - SCENE_RETURN_KEEP_MS, savedAt: T - SCENE_RETURN_KEEP_MS - 1 });
  const edge = entry({ cameraId: 6, dueAt: T - 1_000, savedAt: T - SCENE_RETURN_KEEP_MS });
  const plan = dueSceneReturns([due, exactly, later, old, edge], T);
  assert.deepEqual(plan.due.map((r) => r.cameraId), [1, 2, 6]);
  assert.deepEqual(plan.later.map((r) => r.cameraId), [3]);
  assert.deepEqual(plan.discarded.map((r) => r.cameraId), [5]);
  assert.deepEqual(dueSceneReturns([], T), { due: [], later: [], discarded: [] });
});

test("parseSceneReturns: robust, je Kamera der juengste Eintrag", () => {
  assert.deepEqual(parseSceneReturns(null), []);
  assert.deepEqual(parseSceneReturns({ cameraId: 1 }), []);
  assert.deepEqual(
    parseSceneReturns([
      entry({ cameraId: 1, savedAt: T - 10_000, presetId: 1 }),
      entry({ cameraId: 1, savedAt: T - 5_000, presetId: 3 }),
      { ...entry({ cameraId: 2 }), presetId: "x" },
      { ...entry({ cameraId: 3 }), restoreTrack: "ja" },
      { ...entry({ cameraId: 4 }), dueAt: "bald" },
      { ...entry(), cameraId: 1.5 },
      entry({ cameraId: 7, presetId: null, restoreTrack: null }),
    ]),
    [entry({ cameraId: 1, savedAt: T - 5_000, presetId: 3 }), entry({ cameraId: 7, presetId: null, restoreTrack: null })],
  );
});

test("sceneReturnCamera: Kamera-Liste nicht ladbar, dann behalten und spaeter erneut", () => {
  assert.equal(sceneReturnCamera(true, true), "restore");
  // Kamera schon bekannt, auch wenn ein neuer Abruf scheiterte.
  assert.equal(sceneReturnCamera(true, false), "restore");
  // Cloud nicht erreichbar nach dem Neustart: Der Eintrag bleibt.
  assert.equal(sceneReturnCamera(false, false), "retry");
  // Liste geladen, Kamera entfernt oder deaktiviert: verwerfen.
  assert.equal(sceneReturnCamera(false, true), "drop");
});

test("Rueckkehr wartet auf die Kamera-Liste: auf der Platte bis zum Erfolg, laengstens 24 h", () => {
  const waiting = entry({ cameraId: 4, dueAt: T - 5_000 });
  // Eine laufende Szene einer anderen Kamera ueberschreibt den wartenden Eintrag nicht.
  const other = entry({ cameraId: 9, dueAt: T + 60_000, savedAt: T });
  assert.deepEqual(sceneReturnsToSave([other], [waiting]), [other, waiting]);
  // Eine neue Szene derselben Kamera hat Vorrang.
  const fresh = entry({ cameraId: 4, dueAt: T + 30_000, savedAt: T });
  assert.deepEqual(sceneReturnsToSave([fresh], [waiting]), [fresh]);
  assert.deepEqual(sceneReturnsToSave([], []), []);
  // Was gespeichert ist, liest der naechste Start wieder.
  assert.deepEqual(parseSceneReturns(JSON.parse(JSON.stringify(sceneReturnsToSave([other], [waiting])))), [other, waiting]);
  // Naechster Versuch: weiter faellig; nach 24 h seit dem Speichern verworfen.
  assert.deepEqual(dueSceneReturns([waiting], T + SCENE_RETURN_RETRY_MS).due, [waiting]);
  assert.deepEqual(dueSceneReturns([waiting], waiting.savedAt + SCENE_RETURN_KEEP_MS + 1).discarded, [waiting]);
});
