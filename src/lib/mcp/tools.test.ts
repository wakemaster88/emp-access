import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_HUB_TOOL_LEVELS, MCP_TOOLS, argInt, argStr } from "./tools";
import { MCP_BRIDGE_TOOLS } from "../../../hub/src/agent/mcp-bridge-rules";

test("Hub-Werkzeuge der Cloud passen zur Freigabeliste des Hubs", () => {
  assert.deepEqual(MCP_HUB_TOOL_LEVELS, MCP_BRIDGE_TOOLS);
});

test("Werkzeugnamen sind eindeutig und gueltig", () => {
  const names = MCP_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-z][a-z0-9_]{1,63}$/);
  for (const t of MCP_TOOLS) assert.equal((t.inputSchema as { type: string }).type, "object", t.name);
});

test("keine Netzwerk-Aenderungen und nichts Schaltendes auf Stufe read", () => {
  const names = MCP_TOOLS.map((t) => t.name);
  for (const bad of ["set_vlan", "restart_service", "switch_port", "remember", "ping"]) {
    assert.ok(!names.includes(bad), bad);
  }
  const level = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.level]));
  assert.equal(level.switch_device, "operate");
  assert.equal(level.camera_control, "operate");
  assert.equal(level.mower_action, "operate");
  assert.equal(level.open_gate, "access");
});

test("Eingaben werden begrenzt", () => {
  assert.equal(argInt({}, "n", 5, 1, 10), 5);
  assert.equal(argInt({ n: "500" }, "n", 5, 1, 10), 10);
  assert.equal(argInt({ n: -3 }, "n", 5, 1, 10), 1);
  assert.throws(() => argInt({ n: "abc" }, "n", 5, 1, 10));
  assert.equal(argStr({ q: "  Halle  " }, "q"), "Halle");
  assert.equal(argStr({}, "q"), undefined);
  assert.throws(() => argStr({ q: "" }, "q", { required: true }));
});
