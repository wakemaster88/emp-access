import assert from "node:assert/strict";
import { test } from "node:test";
import { ruleTimerApplies, ruleTimerKind } from "./rule-timer";

test("ruleTimerKind: Laufzeit beim Ventil, Timer im Gerät bei Schalter und Licht", () => {
  assert.equal(ruleTimerKind({ type: "GARDENA_VALVE", category: null }, "open"), "seconds");
  assert.equal(ruleTimerKind({ type: "GARDENA_VALVE", category: null }, "reset"), null, "Stoppen braucht keine Laufzeit");
  assert.equal(ruleTimerKind({ type: "SHELLY", category: "SCHALTER" }, "open"), "autoOffSec");
  assert.equal(ruleTimerKind({ type: "SHELLY", category: "BELEUCHTUNG" }, "open"), "autoOffSec");
  assert.equal(ruleTimerKind({ type: "SHELLY", category: "BELEUCHTUNG" }, "reset"), null);
  assert.equal(ruleTimerKind({ type: "SHELLY", category: "BELEUCHTUNG" }, "emergency"), null);
  assert.equal(ruleTimerKind({ type: "SHELLY", category: "TASTER" }, "open"), null);
  assert.equal(ruleTimerKind({ type: "SHELLY", category: null }, "open"), null);
  assert.equal(ruleTimerKind({ type: "SHELLY", category: "ROLLTOR" }, "open"), null);
  assert.equal(ruleTimerKind({ type: "HUE_LIGHT", category: "BELEUCHTUNG" }, "open"), null);
});

test("ruleTimerApplies: Dialog zeigt das Feld nur, wo es wirkt", () => {
  assert.equal(ruleTimerApplies({ type: "SHELLY", category: "BELEUCHTUNG" }, "open"), true);
  assert.equal(ruleTimerApplies({ type: "SHELLY", category: "TUER" }, "open"), false);
  assert.equal(ruleTimerApplies(null, "open"), false, "noch kein Gerät gewählt");
  assert.equal(ruleTimerApplies({ type: "SHELLY", category: "SCHALTER" }, null), false, "noch kein Befehl gewählt");
});
