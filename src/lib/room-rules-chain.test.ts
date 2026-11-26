import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { prisma } from "./prisma";
import { executeRule, runDeviceSwitchedRules, settleAllHubHandovers, settleHubHandovers } from "./room-rules";
import { switchedFollowUp } from "./rule-run-rules";

// executeRule und die Folgeregeln laufen gegen unterschobene Prisma-Aufrufe,
// ohne Datenbank. Geschaltet wird ein Pi (holt seinen Auftrag selbst ab):
// dafuer genuegt device.update.
type Fn = (args: unknown) => Promise<unknown>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

const PI_TOR = { id: 5, name: "Drehkreuz", type: "RASPBERRY_PI", isActive: true, shellyId: null, ipAddress: null, category: null };
const PI_LICHT = { id: 6, name: "Licht Kasse", type: "RASPBERRY_PI", isActive: true, shellyId: null, ipAddress: null, category: null };

function regel(id: number, trigger: string, actions: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    id,
    accountId: 1,
    name: `Regel ${id}`,
    roomId: null,
    trigger,
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
    actions: actions.map((a, i) => ({ id: id * 10 + i, sortOrder: i, timerSeconds: null, ...a })),
    ...extra,
  };
}

const HAUPT = regel(1, "TIME", [{ kind: "DEVICE", deviceId: 5, deviceAction: "open" }]);
const FOLGE = regel(2, "DEVICE_SWITCHED", [{ kind: "DEVICE", deviceId: 6, deviceAction: "open" }], {
  triggerDeviceId: 5,
  triggerAction: null,
});

let events: string[] = [];

beforeEach(() => {
  events = [];
  db.roomRule.findUnique = async (args) => {
    const id = (args as { where: { id: number } }).where.id;
    return id === 1 ? HAUPT : id === 2 ? FOLGE : null;
  };
  db.roomRule.findMany = async () => [FOLGE];
  db.roomRule.updateMany = async () => ({ count: 1 });
  db.device.findFirst = async (args) => {
    const id = (args as { where: { id: number } }).where.id;
    return id === 5 ? PI_TOR : id === 6 ? PI_LICHT : null;
  };
  db.device.update = async (args) => {
    events.push(`schalten ${(args as { where: { id: number } }).where.id}`);
    return {};
  };
  db.deviceActionLog.create = async () => ({ id: 1 });
  db.roomRuleRun.create = async (args) => {
    const data = (args as { data: { ruleId: number; success: boolean } }).data;
    events.push(`verlauf ${data.ruleId} ${data.success ? "ok" : "fehler"}`);
    return { id: data.ruleId * 100 };
  };
});

test("Folgeregel laeuft nach den eigenen Aktionen und dem eigenen Verlauf, und executeRule wartet auf sie", async () => {
  const result = await executeRule(1, "manual");
  assert.equal(result.success, true);
  assert.deepEqual(events, ["schalten 5", "verlauf 1 ok", "schalten 6", "verlauf 2 ok"]);
});

test("Folgeregel startet nicht, wenn das Geraet den Befehl nicht annahm", async () => {
  db.device.findFirst = async (args) => {
    const id = (args as { where: { id: number } }).where.id;
    // Shelly ohne IP und Cloud-Kennung: sent=false mit Fehlertext.
    return id === 5 ? { ...PI_TOR, type: "SHELLY" } : null;
  };
  const result = await executeRule(1, "manual");
  assert.equal(result.success, false);
  assert.deepEqual(events, ["schalten 5", "verlauf 1 fehler"]);
});

test("Folgeregeln gehen nur eine Stufe tief", async () => {
  // Die Folgeregel schaltet wieder das Geraet, an dem sie haengt.
  const kreis = regel(2, "DEVICE_SWITCHED", [{ kind: "DEVICE", deviceId: 5, deviceAction: "open" }], {
    triggerDeviceId: 5,
    triggerAction: null,
  });
  db.roomRule.findUnique = async (args) => {
    const id = (args as { where: { id: number } }).where.id;
    return id === 1 ? HAUPT : id === 2 ? kreis : null;
  };
  db.roomRule.findMany = async () => [kreis];
  await executeRule(1, "manual");
  assert.deepEqual(events, ["schalten 5", "verlauf 1 ok", "schalten 5", "verlauf 2 ok"]);
});

test("Hue an den Hub uebergeben: Folgeregeln erst mit dem Ergebnis des Auftrags, genau einmal", async () => {
  const HUE = { ...PI_TOR, type: "HUE_LIGHT", hueBridgeId: "b1", hueLightId: "3" };
  db.device.findFirst = async (args) => {
    const id = (args as { where: { id: number } }).where.id;
    return id === 5 ? HUE : id === 6 ? PI_LICHT : null;
  };
  const tasks: Array<{ type: string; payload: unknown; createdAt: Date }> = [];
  db.hubTask.create = async (args) => {
    const data = (args as { data: { type: string; payload: unknown } }).data;
    tasks.push({ ...data, createdAt: new Date() });
    events.push(`auftrag ${data.type}`);
    return { id: 77 };
  };
  db.roomRuleRun.findMany = async () => [];
  db.hubTask.findMany = async () => [];
  await executeRule(1, "manual");
  // Bei der Uebergabe: kein Lauf der Folgeregel.
  assert.equal(events.includes("schalten 6"), false);
  assert.equal(tasks.length, 1);
  assert.deepEqual((tasks[0].payload as { switched?: unknown }).switched, { action: "open", depth: 1 });

  // Ergebnis des Hubs (Ergebnis-Route): erst jetzt, mit der Tiefe der Folgeregeln.
  const now = new Date(tasks[0].createdAt.getTime() + 4_000);
  const done = switchedFollowUp(tasks[0], { success: true, wasOpen: true }, now);
  assert.deepEqual(done, { deviceId: 5, action: "open", depth: 1 });
  events = [];
  await runDeviceSwitchedRules(1, done!.deviceId, done!.action, done!.depth, now);
  assert.deepEqual(events, ["schalten 6", "verlauf 2 ok"]);
  // Gescheitert, zweites Ergebnis, zu spaet: keine Folgeregeln.
  assert.equal(switchedFollowUp(tasks[0], { success: false, wasOpen: true }, now), null);
  assert.equal(switchedFollowUp(tasks[0], { success: true, wasOpen: false }, now), null);
});

test("settleAllHubHandovers (Cron): Mandant fuer Mandant wie runRuleTick, auch ein inaktiver, jede Abfrage im Mandanten", async () => {
  const runs = [
    { id: 1, accountId: 1, details: [{ actionId: 10, target: "Licht", pending: true, hubTaskId: 50 }] },
    { id: 2, accountId: 2, details: [{ actionId: 20, target: "Lampe", pending: true, hubTaskId: 50 }] },
  ];
  const tasks = [{ id: 50, accountId: 1, status: "DONE", error: null }];
  const wheres: Array<[string, Record<string, unknown>]> = [];
  // Mandant 2 ist nicht aktiv; runRuleTick fuehrt seine Regeln trotzdem aus (Regeln ohne Mandanten-Filter).
  const accounts = [
    { id: 1, isActive: true },
    { id: 2, isActive: false },
  ];
  db.account.findMany = async (args) => {
    const where = ((args as { where?: Record<string, unknown> } | undefined)?.where ?? {}) as Record<string, unknown>;
    return accounts.filter((a) => Object.entries(where).every(([k, v]) => a[k as keyof typeof a] === v)).map(({ id }) => ({ id }));
  };
  db.roomRuleRun.findMany = async (args) => {
    const where = (args as { where: Record<string, unknown> }).where;
    wheres.push(["roomRuleRun.findMany", where]);
    return runs.filter((r) => r.accountId === where.accountId);
  };
  db.hubTask.findMany = async (args) => {
    const where = (args as { where: { accountId: number; id: { in: number[] } } }).where;
    wheres.push(["hubTask.findMany", where]);
    return tasks.filter((t) => t.accountId === where.accountId && where.id.in.includes(t.id));
  };
  const updates: Array<{ id: number; success: boolean; errorMessage: string | null }> = [];
  db.roomRuleRun.update = async (args) => {
    const a = args as { where: { id: number; accountId: number }; data: { success: boolean; errorMessage: string | null } };
    wheres.push(["roomRuleRun.update", a.where]);
    updates.push({ id: a.where.id, success: a.data.success, errorMessage: a.data.errorMessage });
    return {};
  };
  assert.equal(await settleAllHubHandovers(), 2);
  // Mandant 2 sieht den Auftrag 50 von Mandant 1 nicht: fuer ihn gibt es ihn nicht.
  assert.deepEqual(updates, [
    { id: 1, success: true, errorMessage: null },
    { id: 2, success: false, errorMessage: "Lampe: Hub-Auftrag nicht mehr vorhanden" },
  ]);
  for (const [name, where] of wheres) assert.equal(typeof where.accountId, "number", name);
  assert.deepEqual(
    wheres.filter(([name]) => name === "roomRuleRun.update").map(([, w]) => [w.id, w.accountId]),
    [[1, 1], [2, 2]],
  );
});

test("settleHubHandovers: liefert eine Abfrage fremde Laeufe oder Auftraege, bleiben sie unberuehrt", async () => {
  db.roomRuleRun.findMany = async () => [
    { id: 1, accountId: 1, details: [{ actionId: 10, target: "Licht", pending: true, hubTaskId: 50 }] },
    { id: 2, accountId: 2, details: [{ actionId: 20, target: "Lampe", pending: true, hubTaskId: 50 }] },
  ];
  db.hubTask.findMany = async () => [{ id: 50, accountId: 2, status: "DONE", error: null }];
  const updates: Array<{ id: number; success: boolean; errorMessage: string | null }> = [];
  db.roomRuleRun.update = async (args) => {
    const a = args as { where: { id: number }; data: { success: boolean; errorMessage: string | null } };
    updates.push({ id: a.where.id, success: a.data.success, errorMessage: a.data.errorMessage });
    return {};
  };
  assert.equal(await settleHubHandovers(1, {}), 1);
  assert.deepEqual(updates, [{ id: 1, success: false, errorMessage: "Licht: Hub-Auftrag nicht mehr vorhanden" }]);
});
