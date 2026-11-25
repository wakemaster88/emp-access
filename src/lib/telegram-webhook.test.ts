import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureTelegramWebhook, planTelegramWebhook } from "./telegram-webhook";

const TOKEN = "123456:TEST-token_abc";
const ORIGIN = "https://beispiel.example";
// Umgestellt wird nur in der Produktion (siehe ensureTelegramWebhook).
process.env.VERCEL_ENV = "production";

test("planTelegramWebhook: alte Form wird umgestellt, Origin bleibt", () => {
  const plan = planTelegramWebhook(`${ORIGIN}/api/telegram/webhook?token=${TOKEN}`, 7);
  assert.deepEqual(plan, { action: "convert", url: `${ORIGIN}/api/telegram/webhook?id=7` });
  // Port bleibt Teil des Origins
  const withPort = planTelegramWebhook(`https://beispiel.example:8443/api/telegram/webhook?token=${TOKEN}`, 3);
  assert.deepEqual(withPort, { action: "convert", url: "https://beispiel.example:8443/api/telegram/webhook?id=3" });
});

test("planTelegramWebhook: neue URL enthaelt nie das Token", () => {
  const plan = planTelegramWebhook(`${ORIGIN}/api/telegram/webhook?token=${encodeURIComponent(TOKEN)}&x=1#frag`, 7);
  assert.equal(plan.action, "convert");
  if (plan.action !== "convert") return;
  assert.ok(!plan.url.includes(TOKEN));
  assert.ok(!plan.url.includes("token"));
  assert.equal(new URL(plan.url).search, "?id=7");
});

test("planTelegramWebhook: id-Form fuer diese Config bleibt", () => {
  assert.deepEqual(planTelegramWebhook(`${ORIGIN}/api/telegram/webhook?id=7`, 7), { action: "none", reason: "current" });
});

test("planTelegramWebhook: leere URL heisst nichts registriert", () => {
  assert.deepEqual(planTelegramWebhook("", 7), { action: "none", reason: "unregistered" });
  assert.deepEqual(planTelegramWebhook(undefined, 7), { action: "none", reason: "unregistered" });
});

test("planTelegramWebhook: fremde URLs bleiben unangetastet", () => {
  const foreign = [
    `${ORIGIN}/api/telegram/webhook?id=8`,
    `${ORIGIN}/api/telegram/webhook?id=7&extra=1`,
    `${ORIGIN}/api/anderer/pfad?token=${TOKEN}`,
    `${ORIGIN}/api/telegram/webhook/?token=${TOKEN}`,
    `http://beispiel.example/api/telegram/webhook?token=${TOKEN}`,
    `https://nutzer:pw@beispiel.example/api/telegram/webhook?token=${TOKEN}`,
    `https://nutzer@beispiel.example/api/telegram/webhook?token=${TOKEN}`,
    `${ORIGIN}/api/telegram/webhook`,
    "kein url",
    "::::",
  ];
  for (const url of foreign) {
    assert.deepEqual(planTelegramWebhook(url, 7), { action: "foreign" }, url);
  }
  // ungueltige Config-ID
  assert.deepEqual(planTelegramWebhook(`${ORIGIN}/api/telegram/webhook?token=${TOKEN}`, 0), { action: "foreign" });
});

type Call = { method: string; body: Record<string, unknown> | null };

function mockTelegram(registered: string, opts: { setOk?: boolean; verifyUrl?: string; throwOn?: string } = {}) {
  const calls: Call[] = [];
  let current = registered;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = String(input);
    assert.ok(href.startsWith("https://api.telegram.org/bot"), "nur Telegram-API (gemockt)");
    const method = href.split("/").pop()!.split("?")[0];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, body });
    if (opts.throwOn === method) throw new Error(`Netzfehler bei ${href}`);
    if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: current } });
    if (method === "setWebhook") {
      if (opts.setOk === false) return Response.json({ ok: false, description: "Bad Request" });
      current = opts.verifyUrl ?? String(body?.url);
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function captureLogs() {
  const lines: string[] = [];
  const log = console.log, err = console.error;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  return { lines, restore: () => { console.log = log; console.error = err; } };
}

test("ensureTelegramWebhook: stellt alte Form um, ohne drop_pending_updates, Log ohne Token", async () => {
  process.env.AUTH_SECRET ||= "test-secret";
  const tg = mockTelegram(`${ORIGIN}/api/telegram/webhook?token=${TOKEN}`);
  const logs = captureLogs();
  try {
    const res = await ensureTelegramWebhook({ id: 7, botToken: TOKEN });
    assert.deepEqual(res, { status: "converted", url: `${ORIGIN}/api/telegram/webhook?id=7` });
    assert.deepEqual(tg.calls.map((c) => c.method), ["getWebhookInfo", "setWebhook", "getWebhookInfo"]);
    const set = tg.calls[1].body!;
    assert.equal(set.url, `${ORIGIN}/api/telegram/webhook?id=7`);
    assert.ok(!("drop_pending_updates" in set));
    assert.equal(typeof set.secret_token, "string");
    assert.equal(logs.lines.length, 1);
    assert.ok(!logs.lines[0].includes(TOKEN));
    assert.ok(!logs.lines[0].includes("?"));
    assert.match(logs.lines[0], /Config #7: umgestellt/);
  } finally {
    logs.restore();
    tg.restore();
  }
});

test("ensureTelegramWebhook: ausserhalb der Produktion kein setWebhook", async () => {
  process.env.AUTH_SECRET ||= "test-secret";
  const before = process.env.VERCEL_ENV;
  for (const env of ["preview", "development", undefined]) {
    if (env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = env;
    const tg = mockTelegram(`${ORIGIN}/api/telegram/webhook?token=${TOKEN}`);
    const logs = captureLogs();
    try {
      const res = await ensureTelegramWebhook({ id: 7, botToken: TOKEN });
      assert.equal(res.status, "failed", String(env));
      assert.deepEqual(tg.calls.map((c) => c.method), ["getWebhookInfo"]);
      assert.equal(logs.lines.length, 1);
      assert.ok(!logs.lines[0].includes(TOKEN));
    } finally {
      logs.restore();
      tg.restore();
    }
  }
  if (before === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = before;
});

test("ensureTelegramWebhook: id-Form und fremde URL loesen kein setWebhook aus", async () => {
  for (const [url, status] of [
    [`${ORIGIN}/api/telegram/webhook?id=7`, "unchanged"],
    ["", "unchanged"],
    [`${ORIGIN}/api/telegram/webhook?id=9`, "foreign"],
  ] as const) {
    const tg = mockTelegram(url);
    try {
      const res = await ensureTelegramWebhook({ id: 7, botToken: TOKEN });
      assert.equal(res.status, status);
      assert.deepEqual(tg.calls.map((c) => c.method), ["getWebhookInfo"]);
    } finally {
      tg.restore();
    }
  }
});

test("ensureTelegramWebhook: Fehler werden gemeldet statt geworfen, ohne Token im Log", async () => {
  process.env.AUTH_SECRET ||= "test-secret";
  const cases = [
    mockTelegram(`${ORIGIN}/api/telegram/webhook?token=${TOKEN}`, { setOk: false }),
  ];
  for (const tg of cases) {
    const logs = captureLogs();
    try {
      const res = await ensureTelegramWebhook({ id: 7, botToken: TOKEN });
      assert.equal(res.status, "failed");
      assert.equal(logs.lines.length, 1);
      assert.ok(!logs.lines[0].includes(TOKEN));
    } finally {
      logs.restore();
      tg.restore();
    }
  }

  for (const opts of [
    { throwOn: "getWebhookInfo" },
    { throwOn: "setWebhook" },
    { verifyUrl: `${ORIGIN}/api/telegram/webhook?token=${TOKEN}` },
  ]) {
    const tg = mockTelegram(`${ORIGIN}/api/telegram/webhook?token=${TOKEN}`, opts);
    const logs = captureLogs();
    try {
      const res = await ensureTelegramWebhook({ id: 7, botToken: TOKEN });
      assert.equal(res.status, "failed", JSON.stringify(opts));
      assert.equal(logs.lines.length, 1);
      assert.ok(!logs.lines[0].includes(TOKEN), logs.lines[0]);
    } finally {
      logs.restore();
      tg.restore();
    }
  }
});
