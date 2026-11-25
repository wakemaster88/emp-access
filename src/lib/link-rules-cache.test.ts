import assert from "node:assert/strict";
import { test } from "node:test";
import { clearLinkRulesCache, loadLinkRulesOrOff } from "./link-rules-cache";
import { LINK_RULES_OFF } from "./link-rules";

function db(impl: () => Promise<{ accessRules: unknown } | null>) {
  let calls = 0;
  return {
    get calls() { return calls; },
    account: { findUnique: async () => { calls++; return impl(); } },
  };
}

test("loadLinkRulesOrOff: Lesefehler heißt alle Regeln aus, ohne Ausnahme", async () => {
  clearLinkRulesCache();
  const origError = console.error;
  console.error = () => {};
  try {
    const failing = db(async () => { throw new Error("db down"); });
    assert.deepEqual(await loadLinkRulesOrOff(failing, 991), LINK_RULES_OFF);
    // Der Fehler wird nicht gespeichert: die nächste Anfrage liest neu.
    const ok = db(async () => ({ accessRules: { kioskDoorsAssignedOnly: true } }));
    const rules = await loadLinkRulesOrOff(ok, 991);
    assert.equal(rules.kioskDoorsAssignedOnly, true);
    assert.equal(ok.calls, 1);
  } finally {
    console.error = origError;
    clearLinkRulesCache();
  }
});

test("loadLinkRulesOrOff: ohne Konto oder ohne Regeln alles aus", async () => {
  clearLinkRulesCache();
  assert.deepEqual(await loadLinkRulesOrOff(db(async () => null), 992), LINK_RULES_OFF);
  assert.deepEqual(await loadLinkRulesOrOff(db(async () => ({ accessRules: null })), 993), LINK_RULES_OFF);
  clearLinkRulesCache();
});
