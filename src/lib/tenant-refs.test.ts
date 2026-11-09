import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanIds, foreignRefError, missingIds } from "./tenant-refs";
import type { TenantDb } from "./prisma";

test("cleanIds: entfernt null, undefined, NaN und Duplikate", () => {
  assert.deepEqual(cleanIds([1, null, undefined, 2, 2, Number.NaN, 1.5]), [1, 2]);
  assert.deepEqual(cleanIds(undefined), []);
});

test("missingIds: liefert nur die fehlenden IDs", () => {
  assert.deepEqual(missingIds([1, 2, 3], [1, 3]), [2]);
  assert.deepEqual(missingIds([1], [1]), []);
});

/** Minimal-Attrappe: jede Tabelle kennt nur die uebergebenen eigenen IDs. */
function fakeDb(own: Record<string, number[]>) {
  const calls: Array<{ model: string; where: unknown }> = [];
  const table = (model: string) => ({
    findMany: async ({ where }: { where: { id: { in: number[] }; accountId?: number } }) => {
      calls.push({ model, where });
      return (own[model] ?? []).filter((id) => where.id.in.includes(id)).map((id) => ({ id }));
    },
  });
  const db = {
    accessArea: table("accessArea"),
    subscription: table("subscription"),
    service: table("service"),
    verein: table("verein"),
    device: table("device"),
  } as unknown as TenantDb;
  return { db, calls };
}

test("foreignRefError: eigene IDs sind in Ordnung", async () => {
  const { db } = fakeDb({ accessArea: [1, 2], device: [7] });
  assert.equal(await foreignRefError(db, 5, { accessAreaIds: [1, 2], deviceIds: [7] }), null);
});

test("foreignRefError: fremde ID wird mit Art und ID gemeldet", async () => {
  const { db } = fakeDb({ accessArea: [1] });
  const error = await foreignRefError(db, 5, { accessAreaIds: [1, 99] });
  assert.match(error ?? "", /Bereich nicht gefunden/);
  assert.match(error ?? "", /99/);
});

test("foreignRefError: Abfragen tragen den accountId-Filter", async () => {
  const { db, calls } = fakeDb({ subscription: [3] });
  await foreignRefError(db, 5, { subscriptionIds: [3] });
  assert.deepEqual(calls, [{ model: "subscription", where: { id: { in: [3] }, accountId: 5 } }]);
});

test("foreignRefError: leere oder fehlende Listen loesen keine Abfrage aus", async () => {
  const { db, calls } = fakeDb({});
  assert.equal(await foreignRefError(db, 5, { accessAreaIds: [null, undefined], vereinIds: [] }), null);
  assert.equal(calls.length, 0);
});
