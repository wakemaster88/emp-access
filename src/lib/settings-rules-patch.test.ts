import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS_RULE_CHANGES_KEPT, parseAccessRuleChanges, parseAccessRules } from "./access-rules";
import { LINK_RULE_CHANGES_KEPT, LINK_RULES_OFF, parseLinkRuleChanges, parseLinkRules } from "./link-rules";
import { mergeSettingsRulesPatch } from "./settings-rules-patch";

const who = { at: "2026-11-25T10:00:00.000Z", adminId: "7", admin: "a@example.org" };
const later = { ...who, at: "2026-11-25T10:01:00.000Z" };

test("mergeSettingsRulesPatch: erster Stand null, nur Einlass-Regel", () => {
  const m = mergeSettingsRulesPatch(null, { readerNeedsArea: true }, who);
  assert.ok(m.stored);
  assert.equal(parseAccessRules(m.stored).readerNeedsArea, true);
  assert.deepEqual(parseAccessRuleChanges(m.stored).map((c) => c.key), ["readerNeedsArea"]);
  // Die Link-Gruppe wird nicht angefasst, bleibt aus.
  assert.equal("linkChanges" in m.stored, false);
  assert.deepEqual(parseLinkRules(m.stored), LINK_RULES_OFF);
  assert.deepEqual(m.newLinkChanges, []);
});

test("mergeSettingsRulesPatch: erster Stand null, nur Link-Regel", () => {
  const m = mergeSettingsRulesPatch(null, { monitorHideNames: true }, who);
  assert.ok(m.stored);
  assert.equal(parseLinkRules(m.stored).monitorHideNames, true);
  assert.deepEqual(parseLinkRuleChanges(m.stored).map((c) => c.key), ["monitorHideNames"]);
  assert.equal("changes" in m.stored, false);
  assert.deepEqual(m.newChanges, []);
});

test("mergeSettingsRulesPatch: beide Gruppen in einem Patch, je ein Verlaufseintrag", () => {
  const m = mergeSettingsRulesPatch(null, { voucherNeedsArea: true, passbackMinutes: 10, riderShortIntro: true, kioskDoorsAssignedOnly: true }, who);
  assert.ok(m.stored);
  assert.deepEqual(parseAccessRuleChanges(m.stored).map((c) => c.key), ["voucherNeedsArea", "passbackMinutes"]);
  assert.deepEqual(parseLinkRuleChanges(m.stored).map((c) => c.key), ["riderShortIntro", "kioskDoorsAssignedOnly"]);
  assert.equal(parseAccessRules(m.stored).passbackMinutes, 10);
  assert.equal(parseLinkRules(m.stored).kioskDoorsAssignedOnly, true);
});

test("mergeSettingsRulesPatch: die andere Gruppe und unbekannte Schlüssel bleiben unverändert", () => {
  const raw = {
    readerNeedsArea: true,
    changes: [{ ...who, key: "readerNeedsArea", from: false, to: true }],
    monitorHideNames: true,
    linkChanges: [{ ...who, key: "monitorHideNames", from: false, to: true }],
    spaeterSchluessel: { a: 1 },
  };
  const link = mergeSettingsRulesPatch(raw, { riderShortIntro: true }, later);
  assert.ok(link.stored);
  assert.deepEqual(link.stored.changes, raw.changes);
  assert.equal(link.stored.readerNeedsArea, true);
  assert.deepEqual(link.stored.spaeterSchluessel, { a: 1 });
  assert.deepEqual(parseLinkRuleChanges(link.stored).map((c) => c.key), ["riderShortIntro", "monitorHideNames"]);

  const entrance = mergeSettingsRulesPatch(raw, { handscannerDenyRedeemed: true }, later);
  assert.ok(entrance.stored);
  assert.deepEqual(entrance.stored.linkChanges, raw.linkChanges);
  assert.equal(entrance.stored.monitorHideNames, true);
  assert.deepEqual(entrance.stored.spaeterSchluessel, { a: 1 });
  assert.deepEqual(parseAccessRuleChanges(entrance.stored).map((c) => c.key), ["handscannerDenyRedeemed", "readerNeedsArea"]);
});

test("mergeSettingsRulesPatch: ohne Änderung nichts zu schreiben", () => {
  const raw = { readerNeedsArea: true, monitorHideNames: true };
  const m = mergeSettingsRulesPatch(raw, { readerNeedsArea: true, monitorHideNames: true, riderShortIntro: false }, who);
  assert.equal(m.stored, null);
  assert.equal(m.rules.readerNeedsArea, true);
  assert.equal(m.links.monitorHideNames, true);
  assert.equal(mergeSettingsRulesPatch(null, {}, who).stored, null);
});

test("mergeSettingsRulesPatch: beide Verläufe an ihrer Grenze gekürzt", () => {
  const raw = {
    changes: Array.from({ length: ACCESS_RULE_CHANGES_KEPT }, () => ({ ...who, key: "readerNeedsArea", from: false, to: true })),
    linkChanges: Array.from({ length: LINK_RULE_CHANGES_KEPT }, () => ({ ...who, key: "monitorHideNames", from: false, to: true })),
  };
  const m = mergeSettingsRulesPatch(raw, { ticketNeedsArea: true, resumeOnlyOwnPause: true }, later);
  assert.ok(m.stored);
  const changes = parseAccessRuleChanges(m.stored);
  const linkChanges = parseLinkRuleChanges(m.stored);
  assert.equal(changes.length, ACCESS_RULE_CHANGES_KEPT);
  assert.equal(linkChanges.length, LINK_RULE_CHANGES_KEPT);
  assert.equal(changes[0].key, "ticketNeedsArea");
  assert.equal(linkChanges[0].key, "resumeOnlyOwnPause");
});

test("mergeSettingsRulesPatch: kaputter Roh-Wert (Array, Zahl) gilt als leer", () => {
  for (const raw of [[], [1], 3, "x"]) {
    const m = mergeSettingsRulesPatch(raw, { monitorHideNames: true }, who);
    assert.ok(m.stored);
    assert.deepEqual(Object.keys(m.stored).sort(), [...Object.keys(LINK_RULES_OFF), "linkChanges"].sort());
  }
});
