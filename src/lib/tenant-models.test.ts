import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TENANT_MODELS } from "./tenant-models";
import { scopeTenantArgs } from "./prisma";

function modelsFromSchema(): string[] {
  const schema = readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
  const out: string[] = [];
  let current: string | null = null;
  for (const line of schema.split("\n")) {
    const m = line.match(/^model\s+(\w+)\s*\{/);
    if (m) { current = m[1]; continue; }
    if (line.startsWith("}")) { current = null; continue; }
    if (current && /^\s+accountId\s+Int\b/.test(line)) out.push(current);
  }
  return [...new Set(out)].sort();
}

test("tenant-models.ts passt zum Prisma-Schema", () => {
  assert.deepEqual([...TENANT_MODELS].sort(), modelsFromSchema());
});

test("Lesende Queries bekommen den Account-Filter", () => {
  assert.deepEqual(scopeTenantArgs("Ticket", "findMany", undefined, 7), { where: { accountId: 7 } });
  assert.deepEqual(scopeTenantArgs("Ticket", "findMany", { where: { status: "VALID" } }, 7), {
    where: { AND: [{ accountId: 7 }, { status: "VALID" }] },
  });
  assert.deepEqual(scopeTenantArgs("Ticket", "findUnique", { where: { id: 3 } }, 7), {
    where: { id: 3, accountId: 7 },
  });
  // Der Account selbst wird ueber seine eigene id eingeschraenkt.
  assert.deepEqual(scopeTenantArgs("Account", "findUnique", { where: { id: 9 } }, 7), {
    where: { id: 7 },
  });
});

test("Schreibende Queries setzen den accountId", () => {
  assert.deepEqual(scopeTenantArgs("Ticket", "create", { data: { name: "x" } }, 7), {
    data: { name: "x", accountId: 7 },
  });
  assert.deepEqual(scopeTenantArgs("Ticket", "createMany", { data: [{ name: "a" }, { name: "b", accountId: 7 }] }, 7), {
    data: [{ name: "a", accountId: 7 }, { name: "b", accountId: 7 }],
  });
  assert.deepEqual(scopeTenantArgs("Ticket", "update", { where: { id: 1 }, data: { name: "y" } }, 7), {
    where: { id: 1, accountId: 7 },
    data: { name: "y" },
  });
  assert.deepEqual(scopeTenantArgs("Ticket", "deleteMany", { where: { id: { in: [1, 2] } } }, 7), {
    where: { AND: [{ accountId: 7 }, { id: { in: [1, 2] } }] },
  });
});

test("Fremder accountId in data wirft", () => {
  assert.throws(() => scopeTenantArgs("Ticket", "create", { data: { name: "x", accountId: 8 } }, 7), /Mandanten-Verstoss/);
  assert.throws(
    () => scopeTenantArgs("Ticket", "create", { data: { name: "x", account: { connect: { id: 8 } } } }, 7),
    /Mandanten-Verstoss/,
  );
});

test("Modelle ohne accountId bleiben unangetastet", () => {
  const args = { where: { ticketId: 1 } };
  assert.equal(scopeTenantArgs("TicketArea", "findMany", args, 7), args);
});
