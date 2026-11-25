import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Statt einer Datenbank ein Ersatz-Client: lib/prisma nimmt außerhalb der
 * Produktion den Client aus `globalThis.prisma`. Jede Abfrage wird als
 * "modell.operation" mitgeschrieben; Antworten kommen aus `answers`, sonst
 * 0 (count), [] (findMany, $queryRaw) oder null.
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
      // Rohe Abfragen (lib/ticket-email): mitschreiben, Antwort aus `answers`, sonst keine Zeilen.
      if (prop === "$queryRaw") {
        return async (...args: unknown[]) => {
          calls.push({ op: prop, args });
          const answer = answers[prop];
          return answer ? answer(args) : [];
        };
      }
      return fakeModel(prop);
    },
  },
);
(globalThis as unknown as { prisma: unknown }).prisma = fakePrisma;

function reset(next: Record<string, (args: unknown) => unknown>) {
  calls.length = 0;
  answers = next;
}

function called(op: string): Call[] {
  return calls.filter((c) => c.op === op);
}

const NOW = new Date("2026-11-24T10:00:00Z");

test("openMailAllowed: bis zur Tagesgrenze jede Adresse, darüber nur bekannte", async () => {
  const { OPEN_MAIL_DAY_CAP, openMailAllowed } = await import("./rider-mail-cap");
  assert.equal(OPEN_MAIL_DAY_CAP, 300);
  assert.equal(openMailAllowed(0, false), true);
  assert.equal(openMailAllowed(OPEN_MAIL_DAY_CAP - 1, false), true);
  assert.equal(openMailAllowed(OPEN_MAIL_DAY_CAP, false), false);
  assert.equal(openMailAllowed(OPEN_MAIL_DAY_CAP, true), true);
  assert.equal(openMailAllowed(OPEN_MAIL_DAY_CAP * 10, true), true);
});

test("OPEN_MAIL_SUBJECTS: App-Link und Familien-Einladung zählen", async () => {
  const { FAMILY_INVITE_MAIL_SUBJECT, OPEN_MAIL_SUBJECTS } = await import("./rider-mail-cap");
  const { DAY_GUEST_MAIL_SUBJECT } = await import("./day-guest");
  const invite = await import("./rider-family-invite");
  assert.deepEqual([...OPEN_MAIL_SUBJECTS], [DAY_GUEST_MAIL_SUBJECT, FAMILY_INVITE_MAIL_SUBJECT]);
  assert.equal(invite.FAMILY_INVITE_MAIL_SUBJECT, FAMILY_INVITE_MAIL_SUBJECT);
});

test("openMailWithinCap: zählt heutige Mails des Kontos, sucht die Adresse erst ab der Grenze", async () => {
  const { openMailWithinCap, OPEN_MAIL_DAY_CAP, OPEN_MAIL_SUBJECTS } = await import("./rider-mail-cap");
  const { berlinDayStart } = await import("./berlin-day");

  reset({ "emailSend.count": () => OPEN_MAIL_DAY_CAP - 1 });
  assert.equal(await openMailWithinCap(5, "neu@example.org", NOW), true);
  const [count] = called("emailSend.count");
  assert.deepEqual(count.args, {
    where: { accountId: 5, subject: { in: [...OPEN_MAIL_SUBJECTS] }, sentAt: { gte: berlinDayStart(NOW) } },
  });
  assert.equal(called("riderProfile.count").length, 0);
  assert.equal(called("ticket.count").length, 0);

  reset({ "emailSend.count": () => OPEN_MAIL_DAY_CAP });
  assert.equal(await openMailWithinCap(5, "neu@example.org", NOW), false);

  reset({ "emailSend.count": () => OPEN_MAIL_DAY_CAP, "riderProfile.count": () => 1 });
  assert.equal(await openMailWithinCap(5, "bekannt@example.org", NOW), true);

  reset({ "emailSend.count": () => OPEN_MAIL_DAY_CAP, "ticket.count": () => 2 });
  assert.equal(await openMailWithinCap(5, "bekannt@example.org", NOW), true);
});

test("requestAppLink: neue Adresse über der Tagesgrenze bekommt keine Mail, unter der Grenze schon", async () => {
  const { requestAppLink } = await import("./rider-onboarding");
  const { OPEN_MAIL_DAY_CAP } = await import("./rider-mail-cap");
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  // Ein Betrieb mit App, Mailversand eingerichtet; der Provider sendet nicht
  // wirklich (sendEmail lehnt ihn ab), der Versuch landet aber in EmailSend.
  const base = {
    "gamificationConfig.findMany": () => [{ accountId: 5, account: { name: "Testbetrieb" } }],
    "emailConfig.findUnique": () => ({ isActive: true, apiKey: "x", fromEmail: "absender@example.org", provider: "TEST" }),
  };

  reset({ ...base, "emailSend.count": () => OPEN_MAIL_DAY_CAP });
  await requestAppLink("neu@example.org", "https://app.example.org", NOW);
  assert.equal(called("emailSend.create").length, 0);

  reset({ ...base, "emailSend.count": () => OPEN_MAIL_DAY_CAP - 1 });
  await requestAppLink("neu@example.org", "https://app.example.org", NOW);
  assert.equal(called("emailSend.create").length, 1);
});

test("inviteFamilyByMail: über der Tagesgrenze dieselbe Antwort, aber kein Versand", async () => {
  const { inviteFamilyByMail } = await import("./rider-family-invite");
  const { OPEN_MAIL_DAY_CAP } = await import("./rider-mail-cap");
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  const base = {
    "emailConfig.findUnique": () => ({ isActive: true, apiKey: "x", fromEmail: "absender@example.org", provider: "GMAIL" }),
    "account.findUnique": () => ({ name: "Testbetrieb" }),
    "riderProfile.findUnique": () => ({ firstName: "Test", nickname: null, tickets: [] }),
    "riderFamily.create": () => ({ id: 7 }),
  };
  const viewer = { id: 11, accountId: 5, familyId: null, familyAdult: false, email: "ich@example.org" };
  let sends = 0;
  const send = async () => {
    sends += 1;
    return { ok: true as const };
  };

  reset({ ...base, "emailSend.count": () => OPEN_MAIL_DAY_CAP });
  assert.equal(await inviteFamilyByMail(viewer, "neu@example.org", "https://app.example.org", NOW, send), "sent");
  assert.equal(sends, 0);

  reset({ ...base, "emailSend.count": () => OPEN_MAIL_DAY_CAP - 1 });
  assert.equal(await inviteFamilyByMail(viewer, "neu@example.org", "https://app.example.org", NOW, send), "sent");
  assert.equal(sends, 1);
});
