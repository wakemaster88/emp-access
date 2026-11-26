import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { prisma } from "./prisma";
import { executeRule, runMotionRules } from "./room-rules";

// Messpunkte im Regel-Verlauf, gegen unterschobene Prisma-Aufrufe ohne
// Datenbank (wie room-rules-chain.test.ts). Geschaltet wird ein Pi: dafuer
// genuegt device.update, das hier kuenstlich 30 ms braucht.
type Fn = (args: unknown) => Promise<unknown>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

const PI = { id: 5, name: "Drehkreuz", type: "RASPBERRY_PI", isActive: true, shellyId: null, ipAddress: null, category: null };

const REGEL = {
  id: 1,
  accountId: 1,
  name: "Licht bei Person",
  roomId: null,
  trigger: "MOTION",
  cameraId: 3,
  eventType: "PERSON",
  daysOfWeek: 127,
  operating: "ANY",
  operatingScheduleId: null,
  operatingExtent: "SELF",
  windowStart: null,
  windowEnd: null,
  onlyWhenDark: false,
  cooldownSeconds: 60,
  lastRunAt: null,
  account: { id: 1, timezone: "Europe/Berlin", latitude: null, longitude: null },
  operatingSchedule: null,
  room: null,
  actions: [{ id: 10, sortOrder: 0, kind: "DEVICE", deviceId: 5, deviceAction: "open", timerSeconds: null }],
};

let runs: Array<Record<string, unknown>> = [];

beforeEach(() => {
  runs = [];
  db.roomRule.findUnique = async () => REGEL;
  // Nur die Bewegungs-Regel, keine Folgeregeln „Gerät geschaltet“.
  db.roomRule.findMany = async (args) =>
    (args as { where: { trigger?: string } }).where.trigger === "MOTION" ? [REGEL] : [];
  db.roomRule.updateMany = async () => ({ count: 1 });
  db.camera.findFirst = async () => ({ keyRoomId: null });
  db.device.findFirst = async () => PI;
  db.device.update = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return {};
  };
  db.deviceActionLog.create = async () => ({ id: 1 });
  db.roomRuleRun.create = async (args) => {
    runs.push((args as { data: Record<string, unknown> }).data);
    return { id: 100 };
  };
});

test("executeRule: Verlauf mit Ereigniszeit, Beginn der Ausführung und Dauer je Aktion", async () => {
  const eventAt = new Date(Date.now() - 1_500);
  const before = Date.now();
  const result = await executeRule(1, "motion", { eventAt });
  assert.equal(result.success, true);
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.equal((run.eventAt as Date).getTime(), eventAt.getTime());
  const startedAt = (run.startedAt as Date).getTime();
  assert.ok(startedAt >= before && startedAt <= Date.now());
  const details = run.details as Array<{ ms?: number; ok: boolean }>;
  assert.equal(details.length, 1);
  assert.ok(typeof details[0].ms === "number" && details[0].ms >= 25, `ms ${details[0].ms}`);
  assert.ok((run.durationMs as number) >= details[0].ms!);
});

test("executeRule: ohne Ereignis (von Hand) bleibt eventAt leer", async () => {
  await executeRule(1, "manual");
  assert.equal("eventAt" in runs[0], false);
  assert.ok(runs[0].startedAt instanceof Date);
});

test("runMotionRules: nennt die ausgelöste Regel mit Zustand und Dauer, Ereigniszeit im Verlauf", async () => {
  const at = new Date(Date.now() - 800);
  const result = await runMotionRules(1, 3, "PERSON", at);
  assert.equal(result.triggered, 1);
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0].ruleId, 1);
  assert.equal(result.rules[0].name, "Licht bei Person");
  assert.equal(result.rules[0].state, "ok");
  assert.ok(result.rules[0].durationMs >= 25);
  assert.equal((runs[0].eventAt as Date).getTime(), at.getTime());
});
