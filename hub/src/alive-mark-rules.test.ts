import { test } from "node:test";
import assert from "node:assert/strict";
import { AliveWriteState, parseAliveMark } from "./alive-mark-rules.js";

const now = Date.parse("2026-11-24T12:00:00Z");

test("Lebenszeichen: gespeicherte Zeit wird gelesen", () => {
  assert.equal(parseAliveMark('{"at":"2026-11-24T06:04:30.000Z"}', now), "2026-11-24T06:04:30.000Z");
  // Eine halbe Minute Uhrenabweichung ist erlaubt.
  assert.equal(parseAliveMark('{"at":"2026-11-24T12:00:30Z"}', now), "2026-11-24T12:00:30.000Z");
});

test("Lebenszeichen: Zukunft, kaputte oder fremde Inhalte gelten als unbekannt", () => {
  assert.equal(parseAliveMark('{"at":"2026-11-24T12:05:00Z"}', now), null);
  assert.equal(parseAliveMark('{"at":"gestern"}', now), null);
  assert.equal(parseAliveMark('{"at":1764000000000}', now), null);
  assert.equal(parseAliveMark("{}", now), null);
  assert.equal(parseAliveMark("null", now), null);
  assert.equal(parseAliveMark('{"at":"2026-11-24T06:0', now), null); // abgeschnitten
  assert.equal(parseAliveMark("", now), null);
});

test("Lebenszeichen: Scheitert das Schreiben, wird der alte Stand entfernt", () => {
  const w = new AliveWriteState();
  const full = "ENOSPC: no space left on device, write";
  const denied = "EACCES: permission denied, open";
  assert.deepEqual(w.after(null, now), { removeOld: false, log: null });
  // Jeder gescheiterte Versuch nimmt den alten Stand weg; im Log steht der Grund einmal.
  assert.deepEqual(w.after(full, now + 30_000), {
    removeOld: true,
    log: `Lebenszeichen: Schreiben fehlgeschlagen (${full})`,
  });
  assert.deepEqual(w.after(full, now + 60_000), { removeOld: true, log: null });
  // Auch Tage spaeter nicht noch einmal, solange der Grund derselbe bleibt.
  const later = now + 7 * 24 * 3_600_000;
  assert.deepEqual(w.after(full, later), { removeOld: true, log: null });
  // Ein anderer Grund ist eine neue Zeile.
  assert.deepEqual(w.after(denied, later + 30_000), {
    removeOld: true,
    log: `Lebenszeichen: Schreiben fehlgeschlagen (${denied})`,
  });
});

test("Lebenszeichen: Erholung steht einmal im Log, derselbe Grund danach wieder", () => {
  const w = new AliveWriteState();
  const full = "ENOSPC: no space left on device, write";
  assert.ok(w.after(full, now).log);
  assert.deepEqual(w.after(null, now + 30_000), { removeOld: false, log: "Lebenszeichen: Schreiben klappt wieder" });
  assert.deepEqual(w.after(null, now + 60_000), { removeOld: false, log: null });
  assert.deepEqual(w.after(full, now + 90_000), {
    removeOld: true,
    log: `Lebenszeichen: Schreiben fehlgeschlagen (${full})`,
  });
});
