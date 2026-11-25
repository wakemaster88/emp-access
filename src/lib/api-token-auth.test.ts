import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import * as tokenAuth from "./api-token-auth";
import * as apiAuth from "./api-auth";

const accountDelegate = prisma.account as unknown as {
  findUnique: (args: { where: { apiToken: string } }) => Promise<unknown>;
};
const deviceDelegate = prisma.device as unknown as {
  findUnique: (args: { where: { apiToken: string } }) => Promise<unknown>;
};

const TOKEN = "c".repeat(64);

function req(path: string) {
  return new NextRequest(`https://example.test${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
}

test("api-auth reicht die Token-Funktionen unveraendert weiter (gleiche Instanzen)", () => {
  assert.equal(apiAuth.validateApiToken, tokenAuth.validateApiToken);
  assert.equal(apiAuth.validateApiOrIntegrationToken, tokenAuth.validateApiOrIntegrationToken);
  assert.equal(apiAuth.hasApiToken, tokenAuth.hasApiToken);
  assert.equal(apiAuth.deviceTokenMismatch, tokenAuth.deviceTokenMismatch);
  assert.equal(apiAuth._clearApiTokenCache, tokenAuth._clearApiTokenCache);
});

test("Ein Token-Cache fuer beide Importwege", async () => {
  let lookups = 0;
  accountDelegate.findUnique = async ({ where }) => {
    lookups++;
    return where.apiToken === TOKEN ? { id: 1, isActive: true } : null;
  };
  deviceDelegate.findUnique = async () => null;
  tokenAuth._clearApiTokenCache();

  const first = await tokenAuth.validateApiToken(req("/api/hub/heartbeat"));
  assert.ok(!("error" in first));
  const second = await apiAuth.validateApiToken(req("/api/hub/heartbeat"));
  assert.ok(!("error" in second));
  assert.equal(lookups, 1, "zweiter Aufruf kommt aus demselben Cache");

  // Leeren ueber api-auth leert auch den Cache von api-token-auth.
  apiAuth._clearApiTokenCache();
  await tokenAuth.validateApiToken(req("/api/hub/heartbeat"));
  assert.equal(lookups, 2);
});

test("api-token-auth importiert weder ./auth noch Anmelde-Bibliotheken", () => {
  const src = readFileSync(join(__dirname, "api-token-auth.ts"), "utf8");
  const specs = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const bad of ["./auth", "@/lib/auth", "./api-auth", "@/lib/api-auth", "next-auth", "bcryptjs", "@simplewebauthn/server"]) {
    assert.ok(!specs.includes(bad), `unerwarteter Import: ${bad}`);
  }
});
