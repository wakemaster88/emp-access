import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Ersatz-Client statt Datenbank (wie in rider-mail-cap.test.ts): lib/prisma
 * nimmt außerhalb der Produktion den Client aus `globalThis.prisma`. Jede
 * Abfrage wird als "modell.operation" mitgeschrieben.
 */
type Call = { op: string; args: unknown };
const calls: Call[] = [];
let answers: Record<string, (args: unknown) => unknown> = {};

function fakeModel(model: string) {
  return new Proxy(
    {},
    {
      get(_target, op) {
        if (typeof op !== "string" || op === "then") return undefined;
        return async (args: unknown) => {
          const key = `${model}.${op}`;
          calls.push({ op: key, args });
          const answer = answers[key];
          if (answer) return answer(args);
          if (op === "count") return 0;
          if (op === "findMany") return [];
          return null;
        };
      },
    },
  );
}

const fakePrisma: unknown = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      if (prop === "$extends") return () => fakePrisma;
      return fakeModel(prop);
    },
  },
);
(globalThis as unknown as { prisma: unknown }).prisma = fakePrisma;

const NOW = new Date("2026-11-24T10:00:00Z");

function ticket(id: number, email: string | null) {
  return {
    id,
    accountId: 1,
    email,
    name: `Gast ${id}`,
    firstName: "Gast",
    lastName: String(id),
    ticketTypeName: "Tageskarte",
    startDate: null,
    endDate: null,
    firstScanAt: null,
    createdAt: new Date("2026-11-24T08:00:00Z"),
    subscriptionId: null,
    serviceId: null,
    riderProfileId: null,
    subscription: null,
    service: null,
    riderProfile: null,
    customer: null,
  };
}

function setup(rule: Record<string, unknown>, tickets: unknown[], cooldownRows: { ticketId: number }[]) {
  calls.length = 0;
  let nextId = 100;
  answers = {
    "account.findUnique": () => ({ id: 1, name: "Testsee" }),
    // Kein GMAIL: sendEmail antwortet ohne Netz mit ok: false.
    "emailConfig.findUnique": () => ({ isActive: true, apiKey: "x", fromEmail: "absender@example.org", provider: "TEST", fromName: null, replyTo: null, brandColor: null, logoUrl: null, websiteUrl: null }),
    "emailRule.findMany": () => [
      {
        id: 7,
        accountId: 1,
        name: "Willkommen",
        trigger: "TICKET_WELCOME",
        daysOffset: 0,
        lookbackDays: 0,
        cooldownDays: 30,
        subject: "Hallo {{firstName}}",
        bodyHtml: "<p>Hallo {{firstName}} {{voucherCode}}</p>",
        createVoucher: false,
        voucherValidDays: null,
        voucherTicketTypeName: null,
        voucherDiscountPercent: null,
        subscriptionId: null,
        serviceId: null,
        renewUrl: null,
        ...rule,
      },
    ],
    "ticket.findMany": () => tickets,
    "emailSend.findMany": () => cooldownRows,
    "emailSend.create": () => ({ id: nextId++ }),
    "voucher.create": () => ({ id: 55, code: "EMP-TEST", expiresAt: null, discountPercent: 10 }),
  };
}

test("Mail-Regel: Eintrag vor Gutschein und Versand, danach Status gesetzt", async () => {
  const { processAccountEmailRules, EMAIL_SEND_PENDING } = await import("./email-automation");
  setup({ createVoucher: true, voucherDiscountPercent: 10 }, [ticket(1, "a@example.org"), ticket(2, "b@example.org")], []);
  const res = await processAccountEmailRules(1, { now: NOW });

  const ops = calls.map((c) => c.op).filter((op) => op.startsWith("emailSend.") || op === "voucher.create");
  // Eine Cooldown-Abfrage für alle, dann je Ticket: anlegen, Gutschein, Status.
  assert.deepEqual(ops, [
    "emailSend.findMany",
    "emailSend.create",
    "voucher.create",
    "emailSend.update",
    "emailSend.create",
    "voucher.create",
    "emailSend.update",
  ]);
  const created = calls.filter((c) => c.op === "emailSend.create").map((c) => (c.args as { data: Record<string, unknown> }).data);
  assert.equal(created[0].status, EMAIL_SEND_PENDING);
  assert.equal(created[0].ticketId, 1);
  const updated = calls.filter((c) => c.op === "emailSend.update").map((c) => (c.args as { data: Record<string, unknown> }).data);
  assert.equal(updated[0].status, "FAILED");
  assert.equal(updated[0].voucherId, 55);
  assert.equal(updated[0].subject, "Hallo Gast");
  assert.equal(res.ruleStats[0].failed, 2);

  // Cooldown zählt SENT und den Eintrag vor dem Versand.
  const where = (calls.find((c) => c.op === "emailSend.findMany")!.args as { where: Record<string, unknown> }).where;
  assert.deepEqual(where.status, { in: ["SENT", EMAIL_SEND_PENDING] });
  assert.deepEqual(where.ticketId, { in: [1, 2] });
});

test("Mail-Regel: Tickets im Cooldown und ohne Adresse werden übersprungen", async () => {
  const { processAccountEmailRules } = await import("./email-automation");
  setup({}, [ticket(1, "a@example.org"), ticket(2, null), ticket(3, "c@example.org")], [{ ticketId: 1 }]);
  const res = await processAccountEmailRules(1, { now: NOW });
  const where = (calls.find((c) => c.op === "emailSend.findMany")!.args as { where: Record<string, unknown> }).where;
  assert.deepEqual(where.ticketId, { in: [1, 3] });
  const created = calls.filter((c) => c.op === "emailSend.create").map((c) => (c.args as { data: Record<string, unknown> }).data.ticketId);
  assert.deepEqual(created, [3]);
  assert.equal(res.ruleStats[0].skipped, 2);
  assert.equal(calls.filter((c) => c.op === "voucher.create").length, 0);
});

test("Mail-Regel: Fehler beim Gutschein markiert den Eintrag als fehlgeschlagen", async () => {
  const { processAccountEmailRules } = await import("./email-automation");
  setup({ createVoucher: true }, [ticket(1, "a@example.org")], []);
  answers["voucher.create"] = () => {
    throw new Error("Code schon vergeben");
  };
  const res = await processAccountEmailRules(1, { now: NOW });
  const updated = calls.filter((c) => c.op === "emailSend.update").map((c) => (c.args as { data: Record<string, unknown> }).data);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].status, "FAILED");
  assert.match(String(updated[0].errorMessage), /Code schon vergeben/);
  assert.match(res.ruleStats[0].errors[0].error, /Regel-Fehler/);
});
