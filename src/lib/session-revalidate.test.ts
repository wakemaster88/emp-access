import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionRevalidator, revalidateOrKeep, type AdminSessionState } from "./session-revalidate";

const TTL = 5 * 60_000;
const T0 = 1_800_000_000_000;

function state(sessionVersion = 0): AdminSessionState {
  return { role: "ADMIN", accountId: 1, accountName: "Test", sessionVersion, accountActive: true };
}

test("createSessionRevalidator: hoechstens eine Abfrage je Admin im Zeitfenster", async () => {
  const calls: number[] = [];
  const check = createSessionRevalidator(async (id) => {
    calls.push(id);
    return state();
  }, TTL);

  const first = await check(7, T0);
  assert.equal(first.checkedAt, T0);
  assert.equal((await check(7, T0 + 1_000)).checkedAt, T0);
  assert.equal((await check(7, T0 + TTL - 1)).checkedAt, T0);
  assert.deepEqual(calls, [7]);

  // Ein anderer Admin hat seinen eigenen Eintrag.
  await check(8, T0 + 1_000);
  assert.deepEqual(calls, [7, 8]);
});

test("createSessionRevalidator: nach dem Zeitfenster wird neu gefragt und die Aenderung greift", async () => {
  let version = 0;
  const check = createSessionRevalidator(async () => state(version), TTL);

  assert.equal((await check(7, T0)).state?.sessionVersion, 0);
  version = 1; // Passwortwechsel
  assert.equal((await check(7, T0 + TTL - 1)).state?.sessionVersion, 0);
  const fresh = await check(7, T0 + TTL);
  assert.equal(fresh.state?.sessionVersion, 1);
  assert.equal(fresh.checkedAt, T0 + TTL);
});

test("createSessionRevalidator: geloeschter Admin wird als null zwischengespeichert", async () => {
  let calls = 0;
  const check = createSessionRevalidator(async () => {
    calls += 1;
    return null;
  }, TTL);
  assert.equal((await check(7, T0)).state, null);
  assert.equal((await check(7, T0 + 1)).state, null);
  assert.equal(calls, 1);
});

test("createSessionRevalidator: gleichzeitige Anfragen teilen sich eine Abfrage", async () => {
  let calls = 0;
  const check = createSessionRevalidator(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return state();
  }, TTL);
  await Promise.all(Array.from({ length: 20 }, () => check(7, T0)));
  assert.equal(calls, 1);
});

test("createSessionRevalidator: ein Datenbankfehler wird nicht zwischengespeichert", async () => {
  let fail = true;
  const check = createSessionRevalidator(async () => {
    if (fail) throw new Error("db weg");
    return state();
  }, TTL);
  await assert.rejects(check(7, T0));
  fail = false;
  assert.ok((await check(7, T0 + 1)).state);
});

test("revalidateOrKeep: ein Ladefehler ergibt undefined statt einer Ausnahme, danach wird neu gefragt", async () => {
  let fail = true;
  let calls = 0;
  const check = createSessionRevalidator(async () => {
    calls += 1;
    if (fail) throw new Error("db weg");
    return state();
  }, TTL);
  assert.equal(await revalidateOrKeep(check, 7), undefined);
  fail = false;
  const next = await revalidateOrKeep(check, 7);
  assert.ok(next?.state);
  assert.equal(calls, 2);
});
