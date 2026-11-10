import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcpMessage, levelAllows, MCP_LATEST_VERSION, type McpTool, type McpServerOptions } from "./protocol";

type Ctx = { calls: string[] };

const tools: McpTool<Ctx>[] = [
  {
    name: "lesen",
    title: "Lesen",
    description: "liest",
    inputSchema: { type: "object", properties: {} },
    level: "read",
    run: async (_a, ctx) => {
      ctx.calls.push("lesen");
      return { ok: 1 };
    },
  },
  {
    name: "schalten",
    title: "Schalten",
    description: "schaltet",
    inputSchema: { type: "object", properties: {} },
    level: "operate",
    levelFor: async (args) => (args.tuer ? "access" : null),
    run: async (_a, ctx) => {
      ctx.calls.push("schalten");
      return "geschaltet";
    },
  },
  {
    name: "kaputt",
    title: "Kaputt",
    description: "wirft",
    inputSchema: { type: "object", properties: {} },
    level: "read",
    run: async () => {
      throw new Error("Hub offline");
    },
  },
];

function opts(level: "read" | "operate" | "access", calls: string[] = []): McpServerOptions<Ctx> {
  return { tools, ctx: { calls }, level, serverInfo: { name: "t", version: "1" } };
}

const call = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, params });

test("Stufen sind geordnet", () => {
  assert.equal(levelAllows("read", "read"), true);
  assert.equal(levelAllows("read", "operate"), false);
  assert.equal(levelAllows("operate", "read"), true);
  assert.equal(levelAllows("operate", "access"), false);
  assert.equal(levelAllows("access", "operate"), true);
});

test("initialize handelt die Version aus", async () => {
  const known = await handleMcpMessage(call(1, "initialize", { protocolVersion: "2025-03-26" }), opts("read"));
  assert.equal((known?.result as { protocolVersion: string }).protocolVersion, "2025-03-26");
  const unknown = await handleMcpMessage(call(2, "initialize", { protocolVersion: "1999-01-01" }), opts("read"));
  const r = unknown?.result as { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
  assert.equal(r.protocolVersion, MCP_LATEST_VERSION);
  assert.deepEqual(r.capabilities, { tools: { listChanged: false } });
  assert.equal(r.serverInfo.name, "t");
});

test("Benachrichtigungen bekommen keine Antwort", async () => {
  assert.equal(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, opts("read")), null);
});

test("ungueltige Nachricht und unbekannte Methode", async () => {
  assert.equal((await handleMcpMessage({ id: 1 }, opts("read")))?.error?.code, -32600);
  assert.equal((await handleMcpMessage(call(3, "resources/list"), opts("read")))?.error?.code, -32601);
  assert.deepEqual((await handleMcpMessage(call(4, "ping"), opts("read")))?.result, {});
});

test("tools/list zeigt nur Werkzeuge der eigenen Stufe", async () => {
  const names = async (level: "read" | "operate") =>
    ((await handleMcpMessage(call(5, "tools/list"), opts(level)))?.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools;
  assert.deepEqual((await names("read")).map((t) => t.name), ["lesen", "kaputt"]);
  const op = await names("operate");
  assert.deepEqual(op.map((t) => t.name), ["lesen", "schalten", "kaputt"]);
  assert.equal(op[1].annotations.readOnlyHint, false);
});

test("tools/call verweigert fremde Stufe, ohne auszufuehren", async () => {
  const calls: string[] = [];
  const r = await handleMcpMessage(call(6, "tools/call", { name: "schalten", arguments: {} }), opts("read", calls));
  assert.equal((r?.result as { isError: boolean }).isError, true);
  assert.deepEqual(calls, []);
});

test("levelFor verlangt fuer Tueren die hoehere Stufe", async () => {
  const calls: string[] = [];
  const denied = await handleMcpMessage(call(7, "tools/call", { name: "schalten", arguments: { tuer: true } }), opts("operate", calls));
  assert.equal((denied?.result as { isError: boolean }).isError, true);
  assert.deepEqual(calls, []);
  const ok = await handleMcpMessage(call(8, "tools/call", { name: "schalten", arguments: { tuer: true } }), opts("access", calls));
  assert.deepEqual(ok?.result, { content: [{ type: "text", text: "geschaltet" }] });
  assert.deepEqual(calls, ["schalten"]);
});

test("Ergebnis als Text und strukturiert, Fehler als isError", async () => {
  const r = await handleMcpMessage(call(9, "tools/call", { name: "lesen" }), opts("read"));
  const res = r?.result as { content: { text: string }[]; structuredContent: unknown };
  assert.deepEqual(JSON.parse(res.content[0].text), { ok: 1 });
  assert.deepEqual(res.structuredContent, { ok: 1 });
  const e = await handleMcpMessage(call(10, "tools/call", { name: "kaputt" }), opts("read"));
  assert.equal((e?.result as { isError: boolean }).isError, true);
  assert.match((e?.result as { content: { text: string }[] }).content[0].text, /Hub offline/);
  const u = await handleMcpMessage(call(11, "tools/call", { name: "gibtsnicht" }), opts("access"));
  assert.equal(u?.error?.code, -32602);
});
