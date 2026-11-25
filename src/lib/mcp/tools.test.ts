import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_HUB_TOOL_LEVELS, MCP_TOOLS, argInt, argStr, describeWeekdays, type McpCtx } from "./tools";
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

test("Backend-Werkzeuge sind reine Lese-Werkzeuge", () => {
  const level = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.level]));
  for (const n of ["opening_hours", "room_rules", "rule_runs", "irrigation", "keys_issued", "lockers", "camera_events", "improve_report"]) {
    assert.equal(level[n], "read", n);
  }
});

test("camera_events: je Ereignis laufend und letzte Aktivitaet, offene Ereignisse kommen eigens dazu", async () => {
  const tool = MCP_TOOLS.find((t) => t.name === "camera_events")!;
  const start = Date.now();
  const ago = (minutes: number) => new Date(start - minutes * 60_000);
  const halle = { name: "Halle", lastSeenAt: ago(1) };
  // Diese Kamera meldet der Hub seit drei Stunden nicht mehr.
  const hof = { name: "Hof", lastSeenAt: ago(180) };
  const person = { id: 4, type: "PERSON", startedAt: ago(30), endedAt: ago(29), camera: halle };
  const openSilent = { id: 3, type: "MOTION", startedAt: ago(200), endedAt: null, camera: hof };
  const openRunning = { id: 1, type: "MOTION", startedAt: ago(240), endedAt: null, camera: halle };

  type Query = { where: Record<string, unknown>; orderBy: Record<string, string>; take: number };
  const calls: Query[] = [];
  const db = {
    cameraEvent: {
      findMany: async (args: Query) => {
        calls.push(args);
        // Die zweite Abfrage holt nur offene; das laufende Ereignis 1 steht
        // in der ersten nicht mehr (dort greift die Grenze).
        return args.where.endedAt === null ? [openRunning, openSilent] : [person, openSilent];
      },
    },
  } as unknown as McpCtx["db"];

  const out = (await tool.run({}, { db, accountId: 7, tokenName: "test" })) as {
    hours: number;
    count: number;
    byType: Record<string, number>;
    events: Array<Record<string, unknown>>;
  };

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.take),
    [200, 50],
  );
  // Beide Abfragen mit derselben Bedingung, die zweite zusaetzlich nur offene.
  assert.equal(calls[0].where.accountId, 7);
  assert.equal("endedAt" in calls[0].where, false);
  assert.deepEqual(calls[1].where, { ...calls[0].where, endedAt: null });
  // Die Liste nennt die juengsten zuerst. Von den offenen kommen die am
  // laengsten offenen zuerst: Ihre Grenze laesst so die juengsten weg, und
  // die stehen schon in der Liste.
  assert.deepEqual(
    calls.map((c) => c.orderBy),
    [{ startedAt: "desc" }, { startedAt: "asc" }],
  );

  assert.equal(out.hours, 6);
  assert.equal(out.count, 3);
  assert.deepEqual(out.byType, { PERSON: 1, MOTION: 2 });
  assert.deepEqual(
    out.events.map((e) => [e.camera, e.type, e.endedAt === null, e.running]),
    [
      ["Halle", "PERSON", false, false],
      // Offen, aber die Kamera schweigt: laeuft nicht mehr.
      ["Hof", "MOTION", true, false],
      ["Halle", "MOTION", true, true],
    ],
  );
  assert.equal(out.events[0].lastActivityAt, ago(29).toISOString());
  assert.equal(out.events[1].lastActivityAt, ago(180).toISOString());
  // Laeuft: letzte Aktivitaet ist der Zeitpunkt der Auskunft.
  const last = Date.parse(String(out.events[2].lastActivityAt));
  assert.ok(last >= start && last <= Date.now());
  // Die letzte Meldung der Kamera selbst steht nicht in der Auskunft.
  assert.deepEqual(Object.keys(out.events[0]), ["camera", "type", "startedAt", "endedAt", "running", "lastActivityAt"]);
});

test("Wochentage aus der Bitmaske", () => {
  assert.equal(describeWeekdays(127), "täglich");
  assert.equal(describeWeekdays(0), "nie");
  assert.equal(describeWeekdays(0b0011111), "Mo, Di, Mi, Do, Fr");
  assert.equal(describeWeekdays(0b1100000), "Sa, So");
});
