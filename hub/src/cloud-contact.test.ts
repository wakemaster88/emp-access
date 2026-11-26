import { test } from "node:test";
import assert from "node:assert/strict";
import { contactResumed, lastCloudContactAt, noteCloudContact, onContactResumed } from "./cloud-contact.js";

const T = Date.parse("2026-11-28T21:00:00.000Z");

test("contactResumed: erster Kontakt seit dem Start und Kontakt nach einer Pause", () => {
  assert.equal(contactResumed(null, T, 15_000), true, "erster Kontakt");
  assert.equal(contactResumed(T, T + 5_000, 15_000), false, "Takt der Auftragsabfrage");
  assert.equal(contactResumed(T, T + 15_000, 15_000), false);
  assert.equal(contactResumed(T, T + 15_001, 15_000), true);
  assert.equal(contactResumed(T, T + 10 * 60_000, 15_000), true, "nach dem Notbetrieb");
});

test("noteCloudContact: Beobachter laufen nach einer Pause, nicht bei jedem Aufruf, und kippen den Aufrufer nicht", async () => {
  const calls: number[] = [];
  onContactResumed(15_000, () => calls.push(lastCloudContactAt() ?? 0));
  onContactResumed(15_000, () => {
    throw new Error("Beobachter kaputt");
  });
  const tick = () => new Promise((r) => setImmediate(r));

  noteCloudContact(T);
  await tick();
  assert.deepEqual(calls, [T], "erster Kontakt");
  noteCloudContact(T + 5_000);
  noteCloudContact(T + 10_000);
  await tick();
  assert.equal(calls.length, 1, "laufender Kontakt");
  // Notbetrieb vorbei: Kontakt nach 10 Minuten.
  noteCloudContact(T + 10 * 60_000);
  await tick();
  assert.deepEqual(calls, [T, T + 10 * 60_000]);
  // Ein aelterer Zeitstempel setzt den Kontakt nicht zurueck.
  noteCloudContact(T);
  assert.equal(lastCloudContactAt(), T + 10 * 60_000);
});
