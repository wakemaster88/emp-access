import { test } from "node:test";
import assert from "node:assert/strict";
import { errorText, resultBody, runGuarded, tasksRunning, trackTask } from "./task-guard.js";

test("Ergebnis eines Handlers geht unveraendert durch", async () => {
  const r = { success: true, result: { opened: true } };
  assert.equal(await runGuarded(async () => r), r);
  assert.deepEqual(await runGuarded(() => ({ success: false, error: "cameraId fehlt" })), {
    success: false,
    error: "cameraId fehlt",
  });
});

test("Handler lehnt ab: Ergebnis fehlgeschlagen statt unbehandelter Ablehnung", async () => {
  const r = await runGuarded(async () => {
    throw new Error("Kamera-Konfig-Abruf fehlgeschlagen: HTTP 502");
  });
  assert.deepEqual(r, { success: false, error: "Unerwarteter Fehler: Kamera-Konfig-Abruf fehlgeschlagen: HTTP 502" });
});

test("Handler wirft sofort (kein Promise): ebenfalls fehlgeschlagen", async () => {
  const r = await runGuarded(() => {
    throw new TypeError("payload ist null");
  });
  assert.equal(r.success, false);
  assert.match(r.error ?? "", /payload ist null/);
});

test("Geworfen wird nicht immer ein Error", async () => {
  assert.equal((await runGuarded(() => Promise.reject("abgebrochen"))).error, "Unerwarteter Fehler: abgebrochen");
  assert.equal((await runGuarded(() => Promise.reject(undefined))).success, false);
  assert.equal(errorText({ code: 7 }), '{"code":7}');
  assert.equal(errorText(new Error("")), "Error");
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  assert.equal(typeof errorText(loop), "string");
});

test("Meldung an die Cloud: nicht serialisierbares Ergebnis geht ohne Nutzdaten hinaus", () => {
  assert.equal(resultBody({ success: true, result: { n: 1 } }), '{"success":true,"result":{"n":1}}');
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  const body = JSON.parse(resultBody({ success: true, result: loop }));
  assert.equal(body.success, true);
  assert.match(body.result.dropped, /nicht übertragbar/);
  const failed = JSON.parse(resultBody({ success: false, result: { big: 1n } }));
  assert.equal(failed.success, false);
  assert.equal(failed.error, "Unbekannter Fehler");
});

test("trackTask: zaehlt laufende Auftraege, auch wenn einer wirft", async () => {
  assert.equal(tasksRunning(), 0);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const a = trackTask(() => gate.then(() => "a"));
  const b = trackTask(async () => {
    throw new Error("weg");
  });
  assert.equal(tasksRunning(), 2);
  await assert.rejects(b, /weg/);
  assert.equal(tasksRunning(), 1);
  release();
  assert.equal(await a, "a");
  assert.equal(tasksRunning(), 0);
});
