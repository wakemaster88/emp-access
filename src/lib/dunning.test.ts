import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDunningStage, dueDunningStage, dunningState, dunningStuck, failDunningStage, nextDunningStep,
  parseDunningConfig, reachedDunningStage, withDunning, runDunningForAccount, type DunningState,
} from "./dunning";
import { dunningMail } from "./dunning-mail";
import { dunningSummary, paymentOpenInfo } from "./payment-open";

const at = (s: string) => new Date(s);
const START = "2026-11-01T08:00:00Z";

test("Stufen laufen nacheinander, auch bei alter Schuld", () => {
  // Vor Tag 3 nichts
  assert.equal(dueDunningStage(START, {}, at("2026-11-03T09:00:00Z")), null);
  assert.equal(dueDunningStage(START, {}, at("2026-11-04T09:00:00Z")), "reminder");
  // Schuld seit Monaten: trotzdem erst die Erinnerung
  assert.equal(dueDunningStage("2026-06-01T00:00:00Z", {}, at("2026-11-21T09:00:00Z")), "reminder");
  assert.equal(dueDunningStage(null, {}, at("2026-11-21T09:00:00Z")), null);

  let d: DunningState = applyDunningStage({}, "reminder", at("2026-11-04T08:20:00Z"), "anny");
  assert.equal(d.reminderVia, "anny");
  assert.equal(dueDunningStage(START, d, at("2026-11-17T09:00:00Z")), null);
  // genau 14 Kalendertage später, auch wenn die Uhrzeit früher ist
  assert.equal(dueDunningStage(START, d, at("2026-11-18T08:19:00Z")), "first");

  d = applyDunningStage(d, "first", at("2026-11-18T08:20:00Z"));
  assert.equal(d.firstDeadline, "2026-12-02");
  assert.equal(dueDunningStage(START, d, at("2026-12-02T09:00:00Z")), "final");

  d = applyDunningStage(d, "final", at("2026-12-02T08:20:00Z"));
  assert.equal(d.finalDeadline, "2026-12-09");
  assert.equal(dueDunningStage(START, d, at("2026-12-08T09:00:00Z")), null);
  assert.equal(dueDunningStage(START, d, at("2026-12-09T09:00:00Z")), "collection");

  d = applyDunningStage(d, "collection", at("2026-12-09T08:20:00Z"));
  assert.equal(reachedDunningStage(d), "collection");
  assert.equal(dueDunningStage(START, d, at("2027-01-01T09:00:00Z")), null);
  assert.equal(nextDunningStep(START, d), null);
});

test("nextDunningStep nennt den Tag der nächsten Stufe", () => {
  assert.deepEqual(nextDunningStep(START, {}), { stage: "reminder", on: "2026-11-04" });
  assert.deepEqual(nextDunningStep(START, { reminderAt: "2026-11-04T08:20:00Z" }), { stage: "first", on: "2026-11-18" });
});

test("Fehlversuche zählen je Stufe und stoppen nach 3", () => {
  let d = failDunningStage({}, "first", "smtp");
  d = failDunningStage(d, "first", "smtp");
  assert.equal(dunningStuck(d, "first"), false);
  d = failDunningStage(d, "first", "smtp");
  assert.equal(dunningStuck(d, "first"), true);
  assert.equal(failDunningStage(d, "final", "x").failedCount, 1);
  const ok = applyDunningStage(d, "first", at("2026-11-18T08:20:00Z"));
  assert.equal(ok.failedStage, undefined);
});

test("Mahnstand liegt im Zahlungsvermerk und lässt den Rest stehen", () => {
  const extras = { rfidCode: "A1", paymentPause: { since: START, amount: 24, invoiceId: "inv-1" } };
  const next = withDunning(extras, { reminderAt: "2026-11-04T08:20:00Z", reminderVia: "anny", failedError: undefined });
  assert.equal(next.rfidCode, "A1");
  const pay = next.paymentPause as Record<string, unknown>;
  assert.equal(pay.amount, 24);
  assert.deepEqual(pay.dunning, { reminderAt: "2026-11-04T08:20:00Z", reminderVia: "anny" });
  assert.equal(dunningState(next).reminderVia, "anny");
  assert.deepEqual(dunningState({ pausedAt: "x" }), {});
  assert.equal(paymentOpenInfo(next)!.invoiceId, "inv-1");
});

test("Schalter: Standard an, nur false schaltet aus", () => {
  assert.equal(parseDunningConfig(null).enabled, true);
  assert.equal(parseDunningConfig("{}").enabled, true);
  assert.equal(parseDunningConfig('{"dunning":{"enabled":false}}').enabled, false);
  assert.equal(parseDunningConfig("kaputt").enabled, true);
});

test("Mails: förmlich, Frist und Inkasso-Hinweis nur in der letzten Mahnung", () => {
  const base = {
    accountName: "Wakepark", firstName: "Lea", person: "Lea M", aboName: "Saisonabo",
    amount: "24 €", invoiceNumber: "R-7", dueDate: "2026-10-21T00:00:00Z", date: at("2026-11-21T09:00:00Z"),
    legalFooter: "Muster GmbH · Weg 1 · 12345 Ort\n\nGeschäftsführer: A B\nAmtsgericht X HRB 1",
  };
  const r = dunningMail({ ...base, stage: "reminder", deadline: null });
  assert.equal(r.subject, "Zahlungserinnerung zu Ihrem Abo");
  assert.match(r.text, /Guten Tag Lea M,/);
  assert.match(r.text, /Offener Betrag: 24 €/);
  assert.match(r.text, /Rechnungsnummer: R-7/);
  assert.match(r.text, /Fällig seit: 21\.10\.2026/);
  assert.match(r.text, /^21\.11\.2026$/m);
  assert.match(r.text, /Geschäftsführer: A B\nAmtsgericht X HRB 1/);
  assert.match(r.text, /Mit freundlichen Grüßen\nIhr Team vom Wakepark/);
  assert.match(r.html, /Muster GmbH · Weg 1 · 12345 Ort<br>Geschäftsführer/);
  assert.doesNotMatch(r.text, /Inkasso/);
  const first = dunningMail({ ...base, stage: "first", deadline: "2026-12-05" });
  assert.match(first.text, /Zahlungserinnerung zu Ihrem Abo „Saisonabo“/);
  assert.match(first.text, /Zahlbar bis: 05\.12\.2026/);
  const f = dunningMail({ ...base, stage: "final", deadline: "2026-12-09" });
  assert.equal(f.subject, "Letzte Mahnung zu Ihrem Abo");
  assert.match(f.text, /bis spätestens 09\.12\.2026/);
  assert.match(f.text, /Inkassounternehmen/);
  assert.doesNotMatch(f.text, /Gebühr/);
  assert.match(dunningMail({ ...base, person: "<b>", stage: "first", deadline: "2026-12-02" }).html, /&lt;b&gt;/);
});

test("dunningSummary für die Abos-Seite", () => {
  const extras = { paymentPause: { since: START, dunning: { reminderAt: "2026-11-04T08:20:00Z" } } };
  const s = dunningSummary(paymentOpenInfo(extras)!, extras);
  assert.equal(s.label, "Zahlungserinnerung");
  assert.deepEqual(s.next, { label: "1. Mahnung", on: "2026-11-18" });
});

// --- Lauf mit Fake-Datenbank ---------------------------------------------------

function fakeDb(tickets: Array<Record<string, unknown>>, opts: { extraConfig?: string } = {}) {
  const updates: Array<{ id: number; extras: Record<string, unknown> }> = [];
  const sends: Array<Record<string, unknown>> = [];
  const db = {
    apiConfig: { findFirst: async () => ({ token: "t", baseUrl: null, extraConfig: opts.extraConfig ?? null }) },
    account: { findUnique: async () => ({ name: "Wakepark", isActive: true }) },
    emailConfig: { findUnique: async () => ({ isActive: true, apiKey: "k", fromEmail: "a@b.de", fromName: null, replyTo: null, provider: "GMAIL", brandColor: null, logoUrl: null, websiteUrl: null, legalFooter: null }) },
    ticket: {
      findMany: async () => tickets,
      update: async ({ where, data }: { where: { id: number }; data: { extras: Record<string, unknown> } }) => {
        updates.push({ id: where.id, extras: data.extras });
        return {};
      },
    },
    emailSend: { create: async ({ data }: { data: Record<string, unknown> }) => { sends.push(data); return {}; } },
  };
  return { db: db as never, updates, sends };
}

const ticket = (id: number, pay: Record<string, unknown>, email: string | null = "kunde@example.org") => ({
  id, name: "Kunde", firstName: "Kim", lastName: "K", email, ticketTypeName: "Saisonabo", subscription: null,
  extras: { paymentPause: { since: START, amount: 24, currency: "EUR", invoiceNumber: "R-1", ...pay } },
});

test("Lauf: Erinnerung über anny, sonst eigene Mail; 1. Mahnung per Mail", async () => {
  const now = at("2026-11-21T08:20:00Z"); // 9:20 Berlin
  const { db, updates, sends } = fakeDb([
    ticket(1, { invoiceId: "inv-1" }),
    ticket(2, { invoiceId: "inv-2" }),
    ticket(3, {}),
    ticket(4, { dunning: { reminderAt: "2026-11-04T08:20:00Z", reminderVia: "anny" } }),
    ticket(5, {}, null),
  ]);
  const mails: string[] = [];
  const r = await runDunningForAccount(db, 1, now, {
    annyRemind: async (id) => (id === "inv-1" ? { ok: true } : { ok: false, error: "404" }),
    send: async ({ subject }) => { mails.push(subject); return { ok: true }; },
  });
  assert.equal(r.viaAnny, 1);
  assert.deepEqual(r.sent, { reminder: 3, first: 1 });
  assert.equal(r.noEmail, 1);
  assert.deepEqual(mails.sort(), ["1. Mahnung zu Ihrem Abo", "Zahlungserinnerung zu Ihrem Abo", "Zahlungserinnerung zu Ihrem Abo"]);
  const byId = new Map(updates.map((u) => [u.id, dunningState(u.extras)]));
  assert.equal(byId.get(1)!.reminderVia, "anny");
  assert.equal(byId.get(2)!.reminderVia, "mail");
  assert.equal(byId.get(4)!.firstDeadline, "2026-12-05");
  assert.equal(byId.get(5)!.failedError, "Keine E-Mail-Adresse am Abo");
  assert.equal(sends.length, 4);
});

test("Lauf: aus, nachts oder ohne Mailversand passiert nichts", async () => {
  const t = [ticket(1, { invoiceId: "inv-1" })];
  const off = fakeDb(t, { extraConfig: '{"dunning":{"enabled":false}}' });
  assert.equal((await runDunningForAccount(off.db, 1, at("2026-11-21T08:20:00Z"), { annyRemind: null })).skipped, "Mahnlauf ausgeschaltet");
  assert.equal(off.updates.length, 0);
  const night = fakeDb(t);
  assert.match((await runDunningForAccount(night.db, 1, at("2026-11-21T03:00:00Z"), { annyRemind: null })).skipped ?? "", /9–20/);
});
