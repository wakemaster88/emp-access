import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma";
import { MCP_TOOLS, type McpCtx } from "./tools";

// open_gate schreibt nach dem Hub-Auftrag einen Eintrag ins Geraete-Protokoll
// (prisma.deviceActionLog.create). Writer und Datenbank werden hier ersetzt.
const delegate = prisma.deviceActionLog as unknown as { create: (args: unknown) => Promise<unknown> };

let rows: Array<Record<string, unknown>> = [];
const tick = () => new Promise((r) => setTimeout(r, 5));
const openGate = MCP_TOOLS.find((t) => t.name === "open_gate")!;

function ctx(status: "DONE" | "FAILED"): McpCtx {
  const db = {
    hubAgent: { findFirst: async () => ({ name: "Hub", lastSeenAt: new Date() }) },
    hubTask: {
      create: async () => ({ id: 1 }),
      findUnique: async () => ({ status, result: { ok: true }, error: status === "FAILED" ? "kaputt" : null }),
    },
  };
  return { db: db as unknown as McpCtx["db"], accountId: 1, tokenName: "Assistent", tokenId: 7 };
}

beforeEach(() => {
  rows = [];
  delegate.create = async (args) => {
    rows.push((args as { data: Record<string, unknown> }).data);
    return { id: 1 };
  };
});

test("open_gate: Eintrag mit Quelle mcp, Ergebnis unveraendert", async () => {
  const res = await openGate.run({ camera: "1" }, ctx("DONE"));
  assert.deepEqual(res, { ok: true });
  await tick();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deviceId, 0);
  assert.equal(rows[0].action, "doorbird_open");
  assert.equal(rows[0].result, "ok");
  assert.equal(rows[0].source, "mcp");
  assert.equal(rows[0].actorLabel, "mcp:7 Assistent");
});

test("open_gate: Fehler des Hubs wird weitergeworfen und als fehler protokolliert", async () => {
  await assert.rejects(() => Promise.resolve(openGate.run({ camera: "1" }, ctx("FAILED"))), /kaputt/);
  await tick();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, "fehler");
});
