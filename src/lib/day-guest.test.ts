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

test("mailLinkKey: trägt die Sitzungs-Version, alte Schlüssel ohne Version gelten weiter", async () => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  const { MAIL_LINK_HOURS_WITH_ACCESS, mailLinkKey, verifyMailLinkKey } = await import("./day-guest");
  const now = new Date("2026-11-25T12:00:00Z");
  const key = mailLinkKey(7, "lena@beispiel.de", now, MAIL_LINK_HOURS_WITH_ACCESS, 3);
  assert.deepEqual(verifyMailLinkKey(key, now), { accountId: 7, email: "lena@beispiel.de", version: 3 });
  assert.ok(verifyMailLinkKey(key, new Date(now.getTime() + 59 * 60_000)));
  assert.equal(verifyMailLinkKey(key, new Date(now.getTime() + 61 * 60_000)), null);
  // Version 0 (Profil noch ohne Zugang) bleibt erhalten.
  assert.deepEqual(verifyMailLinkKey(mailLinkKey(7, "lena@beispiel.de", now, 48, 0), now), { accountId: 7, email: "lena@beispiel.de", version: 0 });

  // Format von vor der Version: gilt bis zu seinem Ablauf, ohne Version.
  const legacyPayload = Buffer.from(JSON.stringify({ a: 7, e: "lena@beispiel.de", x: now.getTime() + 7 * 86_400_000 })).toString("base64url");
  const { createHmac } = await import("node:crypto");
  const legacy = `${legacyPayload}.${createHmac("sha256", process.env.AUTH_SECRET).update(`day-guest-mail:${legacyPayload}`).digest("base64url")}`;
  assert.deepEqual(verifyMailLinkKey(legacy, now), { accountId: 7, email: "lena@beispiel.de" });
  assert.equal(verifyMailLinkKey(legacy, new Date(now.getTime() + 8 * 86_400_000)), null);

  // Version gehört zur Signatur.
  const [payload, sig] = key.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const changed = Buffer.from(JSON.stringify({ ...data, v: 4 })).toString("base64url");
  assert.equal(verifyMailLinkKey(`${changed}.${sig}`, now), null);
});

test("mailLinkStale: Version im Link muss zur sessionVersion des Profils passen", async () => {
  const { mailLinkStale } = await import("./day-guest");
  // Schlüssel ohne Version (vor dem Deploy) gelten bis zum Ablauf.
  assert.equal(mailLinkStale(undefined, { version: 3 }), false);
  // Noch kein Profil zur Adresse (neues Profil, Übernahme aus dem Kundenkonto).
  assert.equal(mailLinkStale(0, null), false);
  assert.equal(mailLinkStale(2, { version: 2 }), false);
  // Passwort geändert, überall abgemeldet oder Zugang zurückgesetzt.
  assert.equal(mailLinkStale(1, { version: 2 }), true);
});
