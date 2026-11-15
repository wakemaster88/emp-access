import { test } from "node:test";
import assert from "node:assert/strict";

test("normalizeEmail: säubert und prüft die Adresse", async () => {
  const { normalizeEmail } = await import("./day-guest");
  assert.equal(normalizeEmail("  Lena@Beispiel.DE "), "lena@beispiel.de");
  assert.equal(normalizeEmail("lena@beispiel"), null);
  assert.equal(normalizeEmail("lena beispiel.de"), null);
  assert.equal(normalizeEmail("a@b.de, c@d.de"), null);
  assert.equal(normalizeEmail("<a@b.de>"), null);
  assert.equal(normalizeEmail(`${"x".repeat(180)}@b.de`), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(null), null);
});

test("mailLinkKey: gilt nur für Konto und Adresse, läuft ab und lässt sich nicht fälschen", async () => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  const { MAIL_LINK_HOURS, mailLinkKey, verifyMailLinkKey } = await import("./day-guest");
  const now = new Date("2026-11-15T12:00:00Z");
  const key = mailLinkKey(7, "lena@beispiel.de", now);
  assert.deepEqual(verifyMailLinkKey(key, now), { accountId: 7, email: "lena@beispiel.de" });

  const justBefore = new Date(now.getTime() + MAIL_LINK_HOURS * 3_600_000 - 1000);
  const justAfter = new Date(now.getTime() + MAIL_LINK_HOURS * 3_600_000 + 1000);
  assert.ok(verifyMailLinkKey(key, justBefore));
  assert.equal(verifyMailLinkKey(key, justAfter), null);

  // Anderer Inhalt mit der alten Signatur.
  const forged = Buffer.from(JSON.stringify({ a: 8, e: "lena@beispiel.de", x: now.getTime() + 3_600_000 })).toString("base64url");
  assert.equal(verifyMailLinkKey(`${forged}.${key.split(".")[1]}`, now), null);
  assert.equal(verifyMailLinkKey(key.slice(0, -1) + (key.endsWith("A") ? "B" : "A"), now), null);
  assert.equal(verifyMailLinkKey("", now), null);
  assert.equal(verifyMailLinkKey("abc", now), null);
});
