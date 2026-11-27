import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIRM_TOKEN_DAYS, createLinkToken, parseLinkToken, verifyLinkToken } from "./tokens";

const SECRET = "test-secret";
const NOW = new Date("2026-11-27T12:00:00Z");

test("Abmeldelink: gültig, auch nach Jahren", () => {
  const token = createLinkToken(SECRET, { purpose: "u", accountId: 1, subscriberId: 42, campaignId: 7 }, NOW);
  const later = new Date("2031-01-01T00:00:00Z");
  assert.deepEqual(verifyLinkToken(SECRET, token, "u", later), {
    purpose: "u",
    accountId: 1,
    subscriberId: 42,
    campaignId: 7,
    issuedDay: Math.floor(NOW.getTime() / 86_400_000),
  });
});

test("Bestätigungslink läuft nach 30 Tagen ab", () => {
  const token = createLinkToken(SECRET, { purpose: "c", accountId: 1, subscriberId: 42, campaignId: 0 }, NOW);
  const ok = new Date(NOW.getTime() + CONFIRM_TOKEN_DAYS * 86_400_000);
  const late = new Date(NOW.getTime() + (CONFIRM_TOKEN_DAYS + 1) * 86_400_000);
  assert.ok(verifyLinkToken(SECRET, token, "c", ok));
  assert.equal(verifyLinkToken(SECRET, token, "c", late), null);
});

test("Falscher Zweck, Schlüssel oder veränderte Teile werden abgelehnt", () => {
  const token = createLinkToken(SECRET, { purpose: "c", accountId: 1, subscriberId: 42, campaignId: 0 }, NOW);
  assert.equal(verifyLinkToken(SECRET, token, "u", NOW), null);
  assert.equal(verifyLinkToken("anderer", token, "c", NOW), null);
  assert.equal(verifyLinkToken(SECRET, token.replace("c.1.42.", "c.1.43."), "c", NOW), null);
  assert.equal(verifyLinkToken(SECRET, token.replace(/^c\.1\./, "c.2."), "c", NOW), null);
});

test("parseLinkToken: Unsinn ergibt null", () => {
  for (const t of [null, 42, "", "abc", "x.1.2.3.4.AAAAAAAAAAAAAAAAAAAAAA", "c.1.2.3.4.zu-kurz"]) {
    assert.equal(parseLinkToken(t), null);
  }
  const token = createLinkToken(SECRET, { purpose: "u", accountId: 3, subscriberId: 9, campaignId: 0 }, NOW);
  assert.equal(parseLinkToken(token)?.accountId, 3);
});
