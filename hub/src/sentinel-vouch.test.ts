import { test } from "node:test";
import assert from "node:assert/strict";
import { sentinelVouch, setSentinelVouch } from "./sentinel-vouch.js";

test("sentinelVouch: ohne Eintrag kein Beleg, mit Eintrag dessen Antwort, bei einem Fehler kein Beleg", () => {
  setSentinelVouch(null);
  assert.equal(sentinelVouch(8).ok, false);
  setSentinelVouch((id) => ({ ok: id === 8, listed: id === 8, why: "Bewertung läuft" }));
  assert.deepEqual(sentinelVouch(8), { ok: true, listed: true, why: "Bewertung läuft" });
  assert.equal(sentinelVouch(9).ok, false);
  setSentinelVouch(() => {
    throw new Error("kaputt");
  });
  assert.deepEqual(sentinelVouch(8), { ok: false, listed: false, why: "Abfrage gescheitert: kaputt" });
  setSentinelVouch(null);
  assert.equal(sentinelVouch(8).ok, false);
});
