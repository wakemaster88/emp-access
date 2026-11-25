import assert from "node:assert/strict";
import { test } from "node:test";
import { LINK_RULES_STRICT, clearLinkRulesCache, loadLinkRulesOrStrict } from "./link-rules-cache";
import { LINK_RULE_KEYS, LINK_RULES_OFF } from "./link-rules";

function db(impl: () => Promise<{ accessRules: unknown } | null>) {
  let calls = 0;
  return {
    get calls() { return calls; },
    account: { findUnique: async () => { calls++; return impl(); } },
  };
}

test("loadLinkRulesOrStrict: Lesefehler heißt für diese Anfrage jede Regel eingeschaltet", async () => {
  clearLinkRulesCache();
  const origError = console.error;
  console.error = () => {};
  try {
    const failing = db(async () => { throw new Error("db down"); });
    assert.deepEqual(await loadLinkRulesOrStrict(failing, 991), LINK_RULES_STRICT);
    for (const key of LINK_RULE_KEYS) assert.equal(LINK_RULES_STRICT[key], true, key);
    // Der Fehler wird nicht gespeichert: die nächste Anfrage liest neu.
    const ok = db(async () => ({ accessRules: { kioskDoorsAssignedOnly: true } }));
    const rules = await loadLinkRulesOrStrict(ok, 991);
    assert.equal(rules.kioskDoorsAssignedOnly, true);
    assert.equal(rules.monitorHideNames, false);
    assert.equal(ok.calls, 1);
  } finally {
    console.error = origError;
    clearLinkRulesCache();
  }
});

test("loadLinkRulesOrStrict: ohne Konto oder ohne Regeln alles aus", async () => {
  clearLinkRulesCache();
  assert.deepEqual(await loadLinkRulesOrStrict(db(async () => null), 992), LINK_RULES_OFF);
  assert.deepEqual(await loadLinkRulesOrStrict(db(async () => ({ accessRules: null })), 993), LINK_RULES_OFF);
  clearLinkRulesCache();
});
