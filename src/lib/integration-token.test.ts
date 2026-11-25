import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { _clearApiTokenCache, validateApiOrIntegrationToken, validateApiToken } from "./api-auth";
import {
  INTEGRATION_SCOPES,
  INTEGRATION_SCOPE_IDS,
  bearerToken,
  hashIntegrationToken,
  integrationLastUsedDue,
  integrationScopeAllows,
  integrationTokenPrefix,
  looksLikeIntegrationToken,
  newIntegrationToken,
  normalizeIntegrationScopes,
  type IntegrationRoute,
} from "./integration-token";

const ROUTES: IntegrationRoute[] = [
  "/api/areas",
  "/api/employees",
  "/api/webhook/utilization",
  "/api/lost-items",
  "/api/lost-items/[id]",
  "/api/lost-items/[id]/image",
];
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

/** Erwartete Matrix: Scope -> erlaubte "METHODE route". */
const EXPECTED: Record<string, string[]> = {
  "areas:read": ["GET /api/areas", "HEAD /api/areas"],
  "employees:read": ["GET /api/employees", "HEAD /api/employees"],
  "utilization:read": ["GET /api/webhook/utilization", "HEAD /api/webhook/utilization"],
  "lost-items": [
    "GET /api/lost-items",
    "HEAD /api/lost-items",
    "POST /api/lost-items",
    "GET /api/lost-items/[id]",
    "HEAD /api/lost-items/[id]",
    "PATCH /api/lost-items/[id]",
    "DELETE /api/lost-items/[id]",
    "GET /api/lost-items/[id]/image",
    "HEAD /api/lost-items/[id]/image",
  ],
};

test("Scope-Matrix: jeder Scope gegen jede Route und Methode", () => {
  assert.deepEqual([...INTEGRATION_SCOPE_IDS].sort(), Object.keys(EXPECTED).sort());
  for (const scope of INTEGRATION_SCOPE_IDS) {
    for (const route of ROUTES) {
      for (const method of METHODS) {
        const want = EXPECTED[scope].includes(`${method} ${route}`);
        assert.equal(integrationScopeAllows([scope], method, route), want, `${scope} ${method} ${route}`);
      }
    }
  }
});

test("Scopes mit :read erlauben nie eine schreibende Methode", () => {
  for (const scope of INTEGRATION_SCOPE_IDS.filter((s) => s.endsWith(":read"))) {
    for (const g of INTEGRATION_SCOPES[scope]) assert.equal(g.method, "GET");
    for (const route of ROUTES) {
      for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.equal(integrationScopeAllows([scope], m, route), false);
      }
    }
  }
});

test("ohne Scope oder mit unbekanntem Scope: nichts erlaubt", () => {
  for (const route of ROUTES) {
    assert.equal(integrationScopeAllows([], "GET", route), false);
    assert.equal(integrationScopeAllows(["admin", "*", "areas"], "GET", route), false);
  }
});

test("Token-Helfer: Format, Hash, Anfang, Bearer, Scopes normalisieren", () => {
  const t = newIntegrationToken();
  assert.ok(looksLikeIntegrationToken(t));
  assert.notEqual(newIntegrationToken(), t);
  assert.equal(hashIntegrationToken(t).length, 64);
  assert.equal(integrationTokenPrefix(t), `${t.slice(0, 8)}…`);
  assert.equal(looksLikeIntegrationToken("int_kurz"), false);
  assert.equal(looksLikeIntegrationToken("a".repeat(64)), false);
  assert.equal(bearerToken(new Headers({ authorization: `Bearer ${t}` })), t);
  assert.equal(bearerToken(new Headers({ authorization: t })), null);
  assert.equal(bearerToken(new Headers()), null);
  assert.deepEqual(normalizeIntegrationScopes(["lost-items", "areas:read", "areas:read", "x"]), ["areas:read", "lost-items"]);
});

test("lastUsedAt hoechstens einmal pro Minute", () => {
  const now = Date.now();
  assert.equal(integrationLastUsedDue(null, now), true);
  assert.equal(integrationLastUsedDue(new Date(now - 30_000), now), false);
  assert.equal(integrationLastUsedDue(new Date(now - 60_000), now), true);
});

// --- validateApiOrIntegrationToken mit ersetzten Prisma-Zugriffen ---------

type IntRow = {
  id: number;
  name: string;
  scopes: string[];
  accountId: number;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  account: { id: number; isActive: boolean };
};

const intDelegate = prisma.integrationToken as unknown as {
  findUnique: (args: { where: { tokenHash: string } }) => Promise<IntRow | null>;
  update: (args: unknown) => Promise<unknown>;
};
const accountDelegate = prisma.account as unknown as {
  findUnique: (args: { where: { apiToken: string } }) => Promise<unknown>;
};
const deviceDelegate = prisma.device as unknown as {
  findUnique: (args: { where: { apiToken: string } }) => Promise<unknown>;
};

const ACCOUNT_TOKEN = "a".repeat(64);
const DEVICE_TOKEN = "d".repeat(64);
const TOKEN_A = newIntegrationToken();
const TOKEN_B = newIntegrationToken();
const TOKEN_REVOKED = newIntegrationToken();

let intRows: Map<string, IntRow>;
let updates: number;

beforeEach(() => {
  _clearApiTokenCache();
  updates = 0;
  intRows = new Map([
    [hashIntegrationToken(TOKEN_A), { id: 1, name: "A", scopes: ["areas:read"], accountId: 1, revokedAt: null, lastUsedAt: null, account: { id: 1, isActive: true } }],
    [hashIntegrationToken(TOKEN_B), { id: 2, name: "B", scopes: ["areas:read", "lost-items"], accountId: 2, revokedAt: null, lastUsedAt: new Date(), account: { id: 2, isActive: true } }],
    [hashIntegrationToken(TOKEN_REVOKED), { id: 3, name: "R", scopes: ["areas:read"], accountId: 1, revokedAt: new Date(), lastUsedAt: null, account: { id: 1, isActive: true } }],
  ]);
  intDelegate.findUnique = async ({ where }) => intRows.get(where.tokenHash) ?? null;
  intDelegate.update = async () => {
    updates++;
    return {};
  };
  accountDelegate.findUnique = async ({ where }) =>
    where.apiToken === ACCOUNT_TOKEN ? { id: 1, isActive: true } : null;
  deviceDelegate.findUnique = async ({ where }) =>
    where.apiToken === DEVICE_TOKEN
      ? { id: 9, type: "RASPBERRY_PI", isActive: true, account: { id: 1, isActive: true } }
      : null;
});

function req(path: string, opts: { method?: string; bearer?: string; query?: string } = {}) {
  const url = `https://example.test${path}${opts.query ? `?token=${opts.query}` : ""}`;
  const headers = opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : undefined;
  return new NextRequest(url, { method: opts.method ?? "GET", headers });
}

async function status(r: Awaited<ReturnType<typeof validateApiOrIntegrationToken>>) {
  return "error" in r ? r.error.status : 200;
}

test("Integrations-Token mit passendem Scope: Konto des Tokens, lastUsedAt gesetzt", async () => {
  const r = await validateApiOrIntegrationToken(req("/api/areas", { bearer: TOKEN_A }), "/api/areas");
  assert.ok(!("error" in r));
  assert.equal(r.account.id, 1);
  assert.equal(r.device, null);
  assert.deepEqual(r.integration, { id: 1, name: "A", scopes: ["areas:read"] });
  assert.equal(updates, 1);
});

test("Integrations-Token: lastUsedAt nicht neu, wenn juenger als eine Minute", async () => {
  const r = await validateApiOrIntegrationToken(req("/api/areas", { bearer: TOKEN_B }), "/api/areas");
  assert.equal(await status(r), 200);
  assert.equal(updates, 0);
});

test("Integrations-Token von Konto B liefert Konto B, nie Konto A", async () => {
  const r = await validateApiOrIntegrationToken(req("/api/areas", { bearer: TOKEN_B }), "/api/areas");
  assert.ok(!("error" in r));
  assert.equal(r.account.id, 2);
});

test("Integrations-Token ohne passenden Scope oder mit schreibender Methode: 403", async () => {
  assert.equal(await status(await validateApiOrIntegrationToken(req("/api/employees", { bearer: TOKEN_A }), "/api/employees")), 403);
  assert.equal(await status(await validateApiOrIntegrationToken(req("/api/areas", { bearer: TOKEN_A, method: "POST" }), "/api/areas")), 403);
  assert.equal(await status(await validateApiOrIntegrationToken(req("/api/lost-items", { bearer: TOKEN_B, method: "POST" }), "/api/lost-items")), 200);
  assert.equal(await status(await validateApiOrIntegrationToken(req("/api/lost-items/1", { bearer: TOKEN_B, method: "PUT" }), "/api/lost-items/[id]")), 403);
});

test("Integrations-Token als ?token=: abgelehnt, auch mit passendem Scope", async () => {
  const r = await validateApiOrIntegrationToken(req("/api/areas", { query: TOKEN_A }), "/api/areas");
  assert.equal(await status(r), 403);
  assert.match(("error" in r && (await r.error.json()).error) || "", /Authorization: Bearer/);
});

test("widerrufenes Integrations-Token: 403", async () => {
  const r = await validateApiOrIntegrationToken(req("/api/areas", { bearer: TOKEN_REVOKED }), "/api/areas");
  assert.equal(await status(r), 403);
  assert.equal(updates, 0);
});

test("Integrations-Token auf Routen mit validateApiToken: abgelehnt", async () => {
  const r = await validateApiToken(req("/api/devices", { bearer: TOKEN_A }));
  assert.ok("error" in r);
  assert.equal(r.error?.status, 403);
});

test("Account-Token: Header und ?token= wie bisher", async () => {
  for (const r of [
    await validateApiOrIntegrationToken(req("/api/areas", { bearer: ACCOUNT_TOKEN }), "/api/areas"),
    await validateApiOrIntegrationToken(req("/api/areas", { query: ACCOUNT_TOKEN }), "/api/areas"),
    await validateApiOrIntegrationToken(req("/api/lost-items", { bearer: ACCOUNT_TOKEN, method: "POST" }), "/api/lost-items"),
  ]) {
    assert.ok(!("error" in r));
    assert.equal(r.account.id, 1);
    assert.equal(r.integration, null);
  }
});

test("Geraete-Token: ohne allowDevice abgelehnt wie bei validateApiToken, unbekanntes Token 403, ohne Token 401", async () => {
  const viaNew = await validateApiOrIntegrationToken(req("/api/areas", { bearer: DEVICE_TOKEN }), "/api/areas");
  _clearApiTokenCache();
  const viaOld = await validateApiToken(req("/api/areas", { bearer: DEVICE_TOKEN }));
  assert.ok("error" in viaNew && "error" in viaOld);
  assert.equal(viaNew.error.status, viaOld.error!.status);
  assert.deepEqual(await viaNew.error.json(), await viaOld.error!.json());

  assert.equal(await status(await validateApiOrIntegrationToken(req("/api/areas", { bearer: "x".repeat(40) }), "/api/areas")), 403);
  // Aussehen wie ein Integrations-Token, aber unbekannt: Pruefung wie bisher.
  assert.equal(await status(await validateApiOrIntegrationToken(req("/api/areas", { bearer: newIntegrationToken() }), "/api/areas")), 403);
  assert.equal(await status(await validateApiOrIntegrationToken(req("/api/areas"), "/api/areas")), 401);
});
