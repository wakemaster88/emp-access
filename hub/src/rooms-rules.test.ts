import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheSyncedAt, cloudActionOutcome, ruleAutoOffSec, shouldReportSwitch } from "./rooms-rules.js";

test("cacheSyncedAt: vermerkter Abruf, sonst die Zeit der Cloud-Antwort", () => {
  assert.equal(cacheSyncedAt({ syncedAt: "2026-11-25T16:58:00.000Z", at: "2026-11-25T16:57:59.000Z" }), "2026-11-25T16:58:00.000Z");
  assert.equal(cacheSyncedAt({ at: "2026-11-25T16:57:59.000Z" }), "2026-11-25T16:57:59.000Z");
  assert.equal(cacheSyncedAt({ syncedAt: "kaputt", at: "2026-11-25T16:57:59.000Z" }), "2026-11-25T16:57:59.000Z");
  assert.equal(cacheSyncedAt({}), null);
});

test("cloudActionOutcome: erledigt nur ohne Fehler und ohne sent=false", () => {
  assert.deepEqual(cloudActionOutcome(true, 200, { sent: true }), { ok: true });
  // Pi: kein sent in der Antwort, der Auftrag wird abgeholt.
  assert.deepEqual(cloudActionOutcome(true, 200, {}), { ok: true });
  assert.deepEqual(cloudActionOutcome(true, 200, { sent: false }), { ok: false, error: "Gerät hat den Befehl nicht angenommen" });
  assert.deepEqual(cloudActionOutcome(true, 200, { sent: false, error: "Shelly nicht erreicht" }), { ok: false, error: "Shelly nicht erreicht" });
  assert.deepEqual(cloudActionOutcome(true, 200, { sent: true, error: "Antrieb blockiert" }), { ok: false, error: "Antrieb blockiert" });
  assert.deepEqual(cloudActionOutcome(false, 403, {}), { ok: false, error: "HTTP 403" });
  assert.deepEqual(cloudActionOutcome(false, 400, { error: "Ungültige Aktion" }), { ok: false, error: "Ungültige Aktion" });
});

test("shouldReportSwitch: nur nach erfolgreicher Schaltung im LAN", () => {
  assert.equal(shouldReportSwitch({ ok: true, via: "lokal" }), true);
  assert.equal(shouldReportSwitch({ ok: false, via: "lokal" }), false);
  // Ueber die Cloud geschaltet: Die Cloud startet ihre Regeln selbst.
  assert.equal(shouldReportSwitch({ ok: true, via: "cloud" }), false);
  assert.equal(shouldReportSwitch({ ok: false, via: "cloud" }), false);
});

test("ruleAutoOffSec: Timer der Regel nur für Shelly-Schalter und -Licht beim Einschalten", () => {
  assert.equal(ruleAutoOffSec({ type: "SHELLY", category: "BELEUCHTUNG" }, "open", 300), 300);
  assert.equal(ruleAutoOffSec({ type: "SHELLY", category: "SCHALTER" }, "open", 59.6), 60);
  assert.equal(ruleAutoOffSec({ type: "SHELLY", category: "BELEUCHTUNG" }, "open", null), undefined, "ohne Wert");
  assert.equal(ruleAutoOffSec({ type: "SHELLY", category: "BELEUCHTUNG" }, "open", 0), undefined);
  // NOT-AUF und Ausschalten: kein Timer.
  assert.equal(ruleAutoOffSec({ type: "SHELLY", category: "BELEUCHTUNG" }, "emergency", 300), undefined);
  assert.equal(ruleAutoOffSec({ type: "SHELLY", category: "BELEUCHTUNG" }, "reset", 300), undefined);
  // Impuls-Geräte behalten ihren Impuls, Antriebe und Hue haben keinen Regel-Timer.
  for (const category of ["TUER", "DREHKREUZ", "TASTER", "ROLLTOR", null]) {
    assert.equal(ruleAutoOffSec({ type: "SHELLY", category }, "open", 300), undefined, String(category));
  }
  assert.equal(ruleAutoOffSec({ type: "HUE_LIGHT", category: "BELEUCHTUNG" }, "open", 300), undefined);
});
