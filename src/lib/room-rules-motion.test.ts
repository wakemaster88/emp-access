import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { prisma } from "./prisma";
import { motionRuleMatches, motionRuleRunner, recordHubRuleRuns, runMotionRules } from "./room-rules";

// Bewegungs-Regeln gegen unterschobene Prisma-Aufrufe ohne Datenbank. Gezaehlt
// wird, wie oft die Regeln und die Kamera abgefragt werden.
type Fn = (args: unknown) => Promise<unknown>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

const STAND = new Date("2026-11-20T09:15:00.000Z");
const hub = (...ids: number[]) => ids.map((ruleId) => ({ ruleId, configAt: STAND.toISOString() }));

function regel(id: number, extra: Record<string, unknown>) {
  return {
    id,
    accountId: 1,
    name: `Regel ${id}`,
    roomId: null,
    trigger: "MOTION",
    cameraId: null,
    eventType: null,
    daysOfWeek: 127,
    operating: "ANY",
    operatingScheduleId: null,
    operatingExtent: "SELF",
    windowStart: null,
    windowEnd: null,
    onlyWhenDark: false,
    cooldownSeconds: 60,
    lastRunAt: null,
    configChangedAt: STAND,
    createdAt: new Date("2026-01-05T08:00:00.000Z"),
    account: { id: 1, timezone: "Europe/Berlin", latitude: null, longitude: null },
    operatingSchedule: null,
    room: null,
    // Ohne Aktionen: executeRule schreibt nur den Verlauf.
    actions: [],
    ...extra,
  };
}

let calls: Record<string, number> = {};
let regeln: ReturnType<typeof regel>[] = [];
let claimFree = true;

beforeEach(() => {
  calls = { rules: 0, camera: 0, runs: 0 };
  regeln = [];
  db.roomRule.findMany = async (args) => {
    if ((args as { where: { trigger?: string } }).where.trigger === "MOTION") calls.rules++;
    return (args as { where: { trigger?: string } }).where.trigger === "MOTION" ? regeln : [];
  };
  db.roomRule.findUnique = async (args) => regeln.find((r) => r.id === (args as { where: { id: number } }).where.id) ?? null;
  db.roomRule.updateMany = async () => {
    calls.claims = (calls.claims ?? 0) + 1;
    return { count: claimFree ? 1 : 0 };
  };
  claimFree = true;
  db.camera.findFirst = async () => {
    calls.camera++;
    return { keyRoomId: 22 };
  };
  db.roomRuleRun.create = async () => {
    calls.runs++;
    return { id: 1 };
  };
});

test("motionRuleMatches: Kamera der Regel, sonst Raum der Kamera; Ereignisart", () => {
  const r = (cameraId: number | null, roomId: number | null, eventType: string | null) => ({ cameraId, roomId, eventType });
  assert.equal(motionRuleMatches(r(3, null, null), 3, 22, "PERSON"), true);
  assert.equal(motionRuleMatches(r(3, 22, null), 4, 22, "PERSON"), false, "andere Kamera im selben Raum");
  assert.equal(motionRuleMatches(r(null, 22, null), 4, 22, "PERSON"), true, "jede Kamera des Raums");
  assert.equal(motionRuleMatches(r(null, 22, null), 4, null, "PERSON"), false, "Kamera ohne Raum");
  assert.equal(motionRuleMatches(r(null, null, null), 4, 22, "PERSON"), false, "weder Kamera noch Raum");
  assert.equal(motionRuleMatches(r(3, null, "VEHICLE"), 3, 22, "PERSON"), false, "andere Ereignisart");
  assert.equal(motionRuleMatches(r(3, null, "PERSON"), 3, 22, "PERSON"), true);
});

test("motionRuleRunner: lädt die Regeln einmal je Meldung", async () => {
  regeln = [regel(1, { cameraId: 3, eventType: "PERSON" }), regel(2, { roomId: 22 })];
  const run = motionRuleRunner(1, new Date());
  const at = new Date();
  const a = await run(3, 22, "PERSON", at);
  const b = await run(4, 22, "MOTION", at);
  const c = await run(5, null, "MOTION", at);
  assert.equal(calls.rules, 1);
  assert.equal(calls.camera, 0, "der Raum kommt aus der Meldung");
  assert.deepEqual(a.rules.map((r) => r.ruleId), [1, 2]);
  assert.deepEqual(b.rules.map((r) => r.ruleId), [2]);
  assert.equal(c.triggered, 0);
});

test("ohne aktive Bewegungs-Regel: sofort zurück, keine weitere Abfrage", async () => {
  const run = motionRuleRunner(1, new Date());
  assert.deepEqual(await run(3, 22, "PERSON", new Date()), { triggered: 0, rules: [], byHub: 0 });
  assert.deepEqual(await run(4, 22, "PERSON", new Date()), { triggered: 0, rules: [], byHub: 0 });
  assert.equal(calls.rules, 1);
  assert.deepEqual(await runMotionRules(1, 3, "PERSON", new Date()), { triggered: 0, rules: [], byHub: 0 });
  assert.equal(calls.camera, 0, "Kamera nicht abgefragt");
  assert.equal(calls.runs, 0);
});

test("runMotionRules: einzelnes Ereignis fragt die Kamera nur mit Regeln ab", async () => {
  regeln = [regel(2, { roomId: 22 })];
  const res = await runMotionRules(1, 4, "PERSON", new Date());
  assert.equal(calls.camera, 1);
  assert.deepEqual(res.rules.map((r) => r.ruleId), [2]);
});

// ─── Bewegungs-Regeln direkt vom Hub (rule-executor.ts) ──────────────────────

const szene = { id: 11, kind: "CAMERA", targetCameraId: 3, deviceId: null, deviceAction: null, sortOrder: 0 };

test("Hub hat die Regel selbst ausgeführt: die Cloud sperrt sie und führt sie nicht noch einmal aus", async () => {
  regeln = [regel(1, { cameraId: 3, actions: [szene] })];
  const res = await motionRuleRunner(1, new Date())(3, 22, "PERSON", new Date(), hub(1));
  assert.equal(res.byHub, 1);
  assert.equal(res.triggered, 0);
  assert.deepEqual(res.rules, []);
  assert.equal(calls.runs, 0, "kein zweiter Lauf");
  assert.equal(calls.claims, 1, "gesperrt wie ein eigener Lauf");
});

test("Älterer Hub ohne Angabe: die Cloud führt alle Regeln aus wie bisher", async () => {
  regeln = [regel(1, { cameraId: 3, actions: [szene] })];
  const res = await motionRuleRunner(1, new Date())(3, 22, "PERSON", new Date());
  assert.equal(res.byHub, 0);
  assert.deepEqual(res.rules.map((r) => r.ruleId), [1]);
  assert.equal(calls.runs, 1);
});

test("Hub nennt eine Regel, die die Cloud jetzt selbst ausführt (geändert): sie läuft in der Cloud", async () => {
  // Ohne Aktion schreibt die Cloud die Regel nicht dem Hub zu (decideExecutor).
  regeln = [regel(1, { cameraId: 3, actions: [] })];
  const res = await motionRuleRunner(1, new Date())(3, 22, "PERSON", new Date(), hub(1));
  assert.equal(res.byHub, 0);
  assert.deepEqual(res.rules.map((r) => r.ruleId), [1]);
  assert.equal(calls.runs, 1);
});

test("Hub nennt nur andere Regeln: die übrigen laufen in der Cloud", async () => {
  regeln = [regel(1, { cameraId: 3, actions: [szene] }), regel(2, { cameraId: 3, actions: [szene] })];
  const res = await motionRuleRunner(1, new Date())(3, 22, "PERSON", new Date(), hub(2, 99));
  assert.equal(res.byHub, 1);
  assert.deepEqual(res.rules.map((r) => r.ruleId), [1]);
  assert.equal(calls.runs, 1);
});

test("Abklingzeit der Cloud sperrt: weder Lauf noch Zählung für den Hub", async () => {
  regeln = [regel(1, { cameraId: 3, actions: [szene] })];
  claimFree = false;
  const res = await motionRuleRunner(1, new Date())(3, 22, "PERSON", new Date(), hub(1));
  assert.deepEqual(res, { triggered: 0, rules: [], byHub: 0 });
  assert.equal(calls.runs, 0);
});

test("Hub hatte einen älteren Stand der Regel (inzwischen geändert): sie läuft in der Cloud", async () => {
  regeln = [regel(1, { cameraId: 3, actions: [szene], configChangedAt: new Date("2026-11-26T10:00:00.000Z") })];
  const res = await motionRuleRunner(1, new Date())(3, 22, "PERSON", new Date(), hub(1));
  assert.equal(res.byHub, 0);
  assert.deepEqual(res.rules.map((r) => r.ruleId), [1]);
  assert.equal(calls.runs, 1);
});

test("Lauf direkt vom Hub, an die Cloud abgegeben: steht im Verlauf, zaehlt nicht fuer ihre Abklingzeit", async () => {
  regeln = [regel(7, {})];
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  db.roomRule.findFirst = async () => regeln[0];
  db.roomRuleRun.findFirst = async () => null;
  db.roomRuleRun.create = async (args) => {
    created.push((args as { data: Record<string, unknown> }).data);
    return { id: created.length };
  };
  db.roomRule.update = async (args) => {
    updated.push((args as { data: Record<string, unknown> }).data);
    return {};
  };
  const eventAt = new Date(STAND.getTime() + 60_000);
  const run = {
    ruleId: 7,
    at: new Date(eventAt.getTime() + 300),
    eventAt,
    finishedAt: new Date(eventAt.getTime() + 5_900),
    triggerKind: "motion",
    success: false,
    details: [
      { actionId: 1, kind: "DEVICE", target: "Licht Hof", ok: true },
      { actionId: 2, kind: "CAMERA", target: "Kamera #3", ok: false, error: "Nicht gestartet: Frist abgelaufen, die Cloud führt die Regel aus" },
    ],
    errorMessage: "Kamera #3: Nicht gestartet: Frist abgelaufen, die Cloud führt die Regel aus",
  };
  assert.equal(await recordHubRuleRuns(1, [{ ...run, handedOver: true }]), 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].triggerKind, "hub:motion");
  assert.equal(created[0].success, false);
  // Die Cloud sperrt die Regel selbst: Kaeme der Lauf vor ihrem Sperren an, fiele ihr Lauf sonst in die Abklingzeit.
  assert.deepEqual(updated, []);
  // Ein Lauf, den der Hub mit dem Ereignis gemeldet hat, zaehlt wie bisher ab dem Ereignis.
  assert.equal(await recordHubRuleRuns(1, [{ ...run, at: new Date(eventAt.getTime() + 400), success: true }]), 1);
  assert.deepEqual(updated, [{ lastRunAt: eventAt }]);
});
