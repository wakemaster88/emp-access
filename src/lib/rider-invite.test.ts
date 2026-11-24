import { test } from "node:test";
import assert from "node:assert/strict";

const now = new Date("2026-11-20T12:00:00Z");
const day = 86_400_000;
const abo = (o: Partial<import("./rider-invite").NewAbo> = {}) => ({
  ticketId: 1,
  email: "Anna@Example.de",
  firstName: "Anna",
  aboName: "Ride Abo",
  subscriptionId: 3,
  startDate: new Date(now.getTime() - day),
  status: "VALID",
  ...o,
});

test("isFreshAbo: nur gültige Abos mit frischem oder künftigem Beginn", async () => {
  const { isFreshAbo, INVITE_FRESH_DAYS } = await import("./rider-invite");
  assert.equal(isFreshAbo(abo(), now), true);
  assert.equal(isFreshAbo(abo({ startDate: new Date(now.getTime() + 30 * day) }), now), true);
  assert.equal(isFreshAbo(abo({ startDate: new Date(now.getTime() - (INVITE_FRESH_DAYS + 1) * day) }), now), false);
  assert.equal(isFreshAbo(abo({ startDate: null }), now), false);
  assert.equal(isFreshAbo(abo({ status: "PAUSED" }), now), false);
  assert.equal(isFreshAbo(abo({ status: "CANCELED" }), now), false);
});

test("inviteCandidates: eine Mail je Adresse, alte Abos und fremde Abo-Arten nicht", async () => {
  const { inviteCandidates } = await import("./rider-invite");
  const list = [
    abo({ ticketId: 1 }),
    abo({ ticketId: 2, email: "anna@example.de ", firstName: "Kind" }),
    abo({ ticketId: 3, email: "alt@example.de", startDate: new Date("2026-05-01T00:00:00Z") }),
    abo({ ticketId: 4, email: null }),
    abo({ ticketId: 5, email: "andere@example.de", subscriptionId: 9 }),
    abo({ ticketId: 6, email: "ben@example.de", subscriptionId: 4 }),
  ];
  assert.deepEqual(inviteCandidates(list, [], now).map((c) => [c.email, c.abo.ticketId]), [
    ["anna@example.de", 1],
    ["andere@example.de", 5],
    ["ben@example.de", 6],
  ]);
  assert.deepEqual(inviteCandidates(list, [3, 4], now).map((c) => c.abo.ticketId), [1, 6]);
});

test("riderInviteMail: Anrede, Abo und Link, Werte maskiert", async () => {
  const { riderInviteMail } = await import("./rider-mail-template");
  const m = riderInviteMail({
    url: "https://app.example/app/mail/abc",
    accountName: "Wasserski <Test>",
    origin: "https://app.example",
    days: 7,
    firstName: "Anna",
    aboName: "Ride Abo",
  });
  assert.equal(m.subject, "Dein Abo ist in der App");
  assert.match(m.html, /Hallo Anna, danke für dein Ride Abo!/);
  assert.match(m.html, /https:\/\/app\.example\/app\/mail\/abc/);
  assert.match(m.html, /Wasserski &lt;Test&gt;/);
  assert.doesNotMatch(m.html, /<Test>/);
  assert.match(m.text, /Der Link gilt 7 Tage/);
  const anon = riderInviteMail({ url: "https://x/app/mail/k", accountName: "A", origin: "https://x", days: 7, firstName: null, aboName: null });
  assert.match(anon.text, /^Willkommen an Bord\n\nDanke für dein Abo!/);
});

test("familyInviteMail: nennt, wer einlädt, Link und Gültigkeit, Werte maskiert", async () => {
  const { familyInviteMail } = await import("./rider-mail-template");
  const m = familyInviteMail({
    url: "https://app.example/app/mail/abc?familie=xyz",
    accountName: "Wasserski <Test>",
    origin: "https://app.example",
    inviterName: "Anna <b>",
    days: 7,
  });
  assert.equal(m.subject, "Einladung in die App");
  assert.match(m.html, /Anna &lt;b&gt; lädt dich in die App von Wasserski &lt;Test&gt; ein/);
  assert.doesNotMatch(m.html, /<b>|<Test>/);
  assert.match(m.html, /app\/mail\/abc\?familie=xyz/);
  assert.match(m.text, /Hier öffnest du sie:\nhttps:\/\/app\.example\/app\/mail\/abc\?familie=xyz/);
  assert.match(m.text, /Der Link gilt 7 Tage/);
  // Der Link allein nimmt niemanden auf: der Beitritt wird in der App bestätigt.
  assert.match(m.text, /trittst du erst bei, wenn du es in der App bestätigst/);
  assert.match(m.html, /Einladung öffnen/);
});

test("mailLinkKey: Einladung gilt länger als der Anmelde-Link", async () => {
  process.env.AUTH_SECRET ||= "test-secret";
  const { mailLinkKey, verifyMailLinkKey } = await import("./day-guest");
  const key = mailLinkKey(1, "anna@example.de", now, 7 * 24);
  assert.deepEqual(verifyMailLinkKey(key, new Date(now.getTime() + 6 * day)), { accountId: 1, email: "anna@example.de" });
  assert.equal(verifyMailLinkKey(key, new Date(now.getTime() + 8 * day)), null);
  assert.equal(verifyMailLinkKey(mailLinkKey(1, "anna@example.de", now), new Date(now.getTime() + 3 * day)), null);
});
