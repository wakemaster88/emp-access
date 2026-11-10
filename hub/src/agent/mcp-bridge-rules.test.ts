import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBridgePayload, clipResult, MCP_BRIDGE_TOOLS } from "./mcp-bridge-rules.js";

const NOW = Date.parse("2026-11-10T10:00:00Z");
const fresh = "2026-11-10T10:00:20Z";

test("lesendes Werkzeug mit Stufe read laeuft", () => {
  const r = checkBridgePayload({ tool: "occupancy", args: { fresh: true }, level: "read", expiresAt: fresh }, NOW);
  assert.deepEqual(r, { ok: true, tool: "occupancy", args: { fresh: true }, level: "read" });
});

test("nicht freigegebene Werkzeuge werden abgelehnt", () => {
  for (const tool of ["switch_device", "restart_service", "remember", "ping", "set_occupancy_threshold", "rm -rf"]) {
    const r = checkBridgePayload({ tool, args: {}, level: "access", expiresAt: fresh }, NOW);
    assert.equal(r.ok, false, tool);
  }
});

test("Stufe wird auf dem Hub noch einmal geprueft", () => {
  assert.equal(checkBridgePayload({ tool: "open_gate", args: {}, level: "operate", expiresAt: fresh }, NOW).ok, false);
  assert.equal(checkBridgePayload({ tool: "open_gate", args: {}, level: "access", expiresAt: fresh }, NOW).ok, true);
  assert.equal(checkBridgePayload({ tool: "mower_action", args: {}, level: "read", expiresAt: fresh }, NOW).ok, false);
  assert.equal(checkBridgePayload({ tool: "camera_control", args: { what: "spotlight" }, level: "operate", expiresAt: fresh }, NOW).ok, true);
  assert.equal(checkBridgePayload({ tool: "camera_control", args: { what: "siren" }, level: "operate", expiresAt: fresh }, NOW).ok, false);
  assert.equal(checkBridgePayload({ tool: "hub_status", args: {}, expiresAt: fresh }, NOW).ok, false);
});

test("abgelaufene Anfragen werden nicht nachgeholt", () => {
  assert.equal(checkBridgePayload({ tool: "open_gate", args: {}, level: "access", expiresAt: "2026-11-10T09:59:00Z" }, NOW).ok, false);
  assert.equal(checkBridgePayload({ tool: "hub_status", args: {}, level: "read" }, NOW).ok, false);
});

test("grosse Ergebnisse werden gekuerzt", () => {
  assert.deepEqual(clipResult({ a: 1 }), { a: 1 });
  const big = clipResult({ x: "y".repeat(100) }, 50) as { truncated: boolean; text: string };
  assert.equal(big.truncated, true);
  assert.ok(big.text.length < 70);
});
