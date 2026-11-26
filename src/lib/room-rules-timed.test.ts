import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { prisma } from "./prisma";
import { recordHubRuleRuns, runRuleTick } from "./room-rules";
import { RULE_CATCH_UP_MS, MISSED_HUB_WAIT_MS, actionKeys, parseHubRulesReport } from "./rule-due";

// Zeit-Regeln im Cron-Lauf und Laeufe des Hubs gegen unterschobene
// Prisma-Aufrufe ohne Datenbank (wie room-rules-chain.test.ts). Die Zeilen
// liegen in `world`; Abfragen werten die Bedingungen aus, die room-rules.ts
// stellt, und halten fest, ob jede nach dem Mandanten filtert.
type Fn = (args: unknown) => Promise<unknown>;
const db = prisma as unknown as Record<string, Record<string, Fn>>;

const MIN = 60_000;
// Samstag, 28.11.2026, 22:00 MEZ.
const AT = new Date("2026-11-28T21:00:00.000Z");

type Row = Record<string, unknown> & { id: number; accountId: number };

interface World {
  rules: Row[];
  runs: Row[];
  tasks: Row[];
  devices: Row[];
  hub: { lastSeenAt: Date | null; status: unknown } | null;
  /** Uhr fuer neue Verlaufszeilen (Standard der Datenbank: jetzt). */
  clock: Date;
  ruleUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  /** Abfragen auf Verlauf, Auftraege und Regeln ohne `accountId`. */
  unscoped: string[];
}

let world: World;

function regel(id: number, extra: Record<string, unknown> = {}): Row {
  const actions = (extra.actions as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    id,
    accountId: 1,
    name: `Regel ${id}`,
    roomId: null,
    trigger: "TIME",
    timeOfDay: "22:00",
    offsetMinutes: 0,
    daysOfWeek: 127,
    operating: "ANY",
    operatingScheduleId: null,
    operatingExtent: "SELF",
    windowStart: null,
    windowEnd: null,
    onlyWhenDark: false,
    cooldownSeconds: 0,
    isActive: true,
    lastRunAt: null,
    lastOccurrenceAt: null,
    lastMissedAt: null,
    createdAt: new Date("2026-11-01T08:00:00.000Z"),
    configChangedAt: null,
    account: { id: 1, timezone: "Europe/Berlin", latitude: null, longitude: null },
    operatingSchedule: null,
    room: null,
    ...extra,
    actions: actions.map((a, i) => ({
      id: id * 10 + i,
      sortOrder: i,
      timerSeconds: null,
      channel: null,
      targetCameraId: null,
      ptzPresetId: null,
      autoTrack: null,
      returnAfterSeconds: null,
      ...a,
    })),
  };
}

/** Bedingung einer Abfrage auf eine Zeile anwenden (nur, was room-rules.ts stellt). */
function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  for (const [field, cond] of Object.entries(where)) {
    if (field === "OR") {
      if (!(cond as Array<Record<string, unknown>>).some((c) => matches(row, c))) return false;
      continue;
    }
    if (field === "AND") {
      if (!(cond as Array<Record<string, unknown>>).every((c) => matches(row, c))) return false;
      continue;
    }
    const value = row[field];
    if (cond === null || typeof cond !== "object" || cond instanceof Date) {
      const same = cond instanceof Date ? value instanceof Date && value.getTime() === cond.getTime() : (value ?? null) === cond;
      if (!same) return false;
      continue;
    }
    const c = cond as Record<string, unknown>;
    const n = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));
    if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
    if ("not" in c && (value ?? null) === c.not) return false;
    if ("gte" in c && (value == null || n(value) < n(c.gte))) return false;
    if ("gt" in c && (value == null || n(value) <= n(c.gt))) return false;
    if ("lt" in c && (value == null || n(value) >= n(c.lt))) return false;
    if ("lte" in c && (value == null || n(value) > n(c.lte))) return false;
  }
  return true;
}

/** Abfrage ohne Mandanten (oder mit etwas anderem als einer Mandanten-ID) fuer afterEach notieren. */
function noteScope(model: string, where: Record<string, unknown> | undefined): void {
  if (!where || typeof where.accountId !== "number") world.unscoped.push(`${model} ${JSON.stringify(where)}`);
}

/**
 * Wie Prisma `update`: genau die Zeile, auf die die ganze Bedingung passt, mit
 * dem Wert des Mandanten, nicht nur nach ID; sonst ein Fehler.
 */
function updateRow(model: string, rows: Row[], where: Record<string, unknown>, data: Record<string, unknown>): Row {
  noteScope(model, where);
  const row = rows.find((r) => matches(r, where));
  if (!row) throw new Error(`${model}: keine Zeile zu ${JSON.stringify(where)}`);
  return Object.assign(row, data);
}

/** Sperre `claimRule` (bestehende Abfrage, nur nach ID der schon geladenen Regel). */
function isClaim(where: Record<string, unknown>): boolean {
  return Object.keys(where).join() === "id,OR" && JSON.stringify(where.OR).includes("lastRunAt");
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const by = orderBy as { triggeredAt?: "asc" | "desc" } | undefined;
  if (!by?.triggeredAt) return rows;
  const dir = by.triggeredAt === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => dir * ((a.triggeredAt as Date).getTime() - (b.triggeredAt as Date).getTime()));
}

beforeEach(() => {
  world = { rules: [], runs: [], tasks: [], devices: [], hub: null, clock: AT, ruleUpdates: [], unscoped: [] };
  db.account.findMany = async () => [{ id: 1 }];
  db.roomRule.findMany = async (args) => {
    const a = args as { where: Record<string, unknown> };
    // Der Cron laedt alle Mandanten (bestehende Abfrage); alles andere je Mandant.
    if (!(a.where.trigger as { in?: unknown } | undefined)?.in) noteScope("roomRule.findMany", a.where);
    return world.rules.filter((r) => matches(r, a.where));
  };
  db.roomRule.findUnique = async (args) => world.rules.find((r) => r.id === (args as { where: { id: number } }).where.id) ?? null;
  db.roomRule.findFirst = async (args) => {
    const a = args as { where: Record<string, unknown> };
    noteScope("roomRule.findFirst", a.where);
    return world.rules.find((r) => matches(r, a.where)) ?? null;
  };
  db.roomRule.updateMany = async (args) => {
    const a = args as { where: Record<string, unknown>; data: Record<string, unknown> };
    if (!isClaim(a.where)) noteScope("roomRule.updateMany", a.where);
    world.ruleUpdates.push(a);
    const hit = world.rules.filter((r) => matches(r, a.where));
    for (const r of hit) Object.assign(r, a.data);
    return { count: hit.length };
  };
  db.roomRule.update = async (args) => {
    const a = args as { where: Record<string, unknown>; data: Record<string, unknown> };
    return updateRow("roomRule.update", world.rules, a.where, a.data);
  };
  db.roomRuleRun.findMany = async (args) => {
    const a = args as { where: Record<string, unknown>; orderBy?: unknown; take?: number };
    noteScope("roomRuleRun.findMany", a.where);
    return sortRows(world.runs.filter((r) => matches(r, a.where)), a.orderBy).slice(0, a.take ?? 1000);
  };
  db.roomRuleRun.findFirst = async (args) => {
    const a = args as { where: Record<string, unknown> };
    noteScope("roomRuleRun.findFirst", a.where);
    return world.runs.find((r) => matches(r, a.where)) ?? null;
  };
  db.roomRuleRun.create = async (args) => {
    const data = (args as { data: Record<string, unknown> }).data;
    const row = { triggeredAt: world.clock, errorMessage: null, ...data, id: world.runs.length + 1 } as unknown as Row;
    world.runs.push(row);
    return row;
  };
  db.roomRuleRun.update = async (args) => {
    const a = args as { where: Record<string, unknown>; data: Record<string, unknown> };
    return updateRow("roomRuleRun.update", world.runs, a.where, a.data);
  };
  db.hubTask.findMany = async (args) => {
    const a = args as { where: Record<string, unknown> };
    noteScope("hubTask.findMany", a.where);
    return world.tasks.filter((t) => matches(t, a.where));
  };
  db.hubTask.create = async (args) => {
    const data = (args as { data: Record<string, unknown> }).data;
    const task = { ...data, id: 500 + world.tasks.length, status: "PENDING", error: null, createdAt: world.clock } as unknown as Row;
    world.tasks.push(task);
    return task;
  };
  db.hubAgent.findFirst = async () => world.hub;
  db.device.findMany = async (args) => world.devices.filter((d) => matches(d, (args as { where: Record<string, unknown> }).where));
  db.device.findFirst = async (args) => world.devices.find((d) => matches(d, (args as { where: Record<string, unknown> }).where)) ?? null;
  db.device.update = async () => ({});
  db.deviceActionLog.create = async () => ({ id: 1 });
  db.camera.findFirst = async (args) => {
    const id = (args as { where: { id: number } }).where.id;
    return { id, name: `Kamera ${id}`, enabled: true };
  };
  db.telegramConfig.findMany = async () => [];
});

// Jede neue Abfrage auf Regeln, Verlauf und Auftraege bleibt im Mandanten.
afterEach(() => {
  assert.deepEqual(world.unscoped, []);
});

/** Lebenszeichen des Hubs zur Zeit `at`, wie die heartbeat-Route es ablegt. */
function heartbeat(at: Date, extra: Record<string, unknown> = {}) {
  const rules = parseHubRulesReport(
    { mode: "cloud", pending: 0, fires: [], coverClose: true, planUntil: new Date(at.getTime() + 40 * 3_600_000).toISOString(), ...extra },
    at,
  );
  return { lastSeenAt: at, status: { rules } };
}

const GATE = { id: 9, accountId: 1, name: "Rolltor", type: "SHELLY", category: "ROLLTOR", ipAddress: "192.168.1.40", hueBridgeId: null, hueLightId: null, isActive: true };

// ─── Luecke zwischen letztem Kontakt und Ausfall ─────────────────────────────

test("Meldung „nicht bestaetigt“: sagt nur, dass der Hub geschaltet haben kann", async () => {
  const rule = regel(1, { actions: [{ kind: "DEVICE", deviceId: 9, deviceAction: "close" }] });
  world.rules = [rule];
  world.devices = [GATE];
  // Lebenszeichen zum Termin, dann still (Netz am Standort weg); der Cron scheiterte.
  world.hub = heartbeat(AT);
  const key = actionKeys(rule.actions as never).get((rule.actions as Row[])[0].id);
  world.runs = [
    {
      id: 1,
      accountId: 1,
      ruleId: 1,
      triggerKind: "time",
      triggeredAt: new Date(AT.getTime() + 41_000),
      success: false,
      details: [{ key, ok: false, error: "Gerät offline" }],
      errorMessage: "Rolltor: Gerät offline",
    },
  ];
  // Frist vorbei: Die Meldung wartet auf den Hub.
  const until = AT.getTime() + RULE_CATCH_UP_MS;
  world.clock = new Date(until + 5 * MIN);
  let tick = await runRuleTick(world.clock);
  assert.deepEqual(tick.results, []);
  // Eine Stunde danach: „nicht bestaetigt“, ohne zu behaupten, der Hub habe geschaltet.
  world.clock = new Date(until + MISSED_HUB_WAIT_MS);
  tick = await runRuleTick(world.clock);
  assert.equal(tick.results[0]?.kind, "verpasst");
  const missed = world.runs.find((r) => r.triggerKind === "missed");
  const text = String(missed?.errorMessage);
  assert.match(text, /nicht bestätigt/);
  assert.match(text, /kann den Termin im Notbetrieb selbst geschaltet haben/);
  assert.doesNotMatch(text, /schaltet im Notbetrieb selbst/);
  assert.match(text, /kein Lebenszeichen/);
});

test("Lauf des Hubs kurz vor dem Kontakt zu einem erledigten Termin: im Verlauf, aber kein zweiter Termin", async () => {
  const rule = regel(1, { actions: [{ kind: "DEVICE", deviceId: 9, deviceAction: "close" }], lastOccurrenceAt: AT });
  world.rules = [rule];
  const key = actionKeys(rule.actions as never).get((rule.actions as Row[])[0].id);
  world.runs = [
    { id: 1, accountId: 1, ruleId: 1, triggerKind: "time", triggeredAt: new Date(AT.getTime() + 41_000), success: true, details: [{ key, ok: true }], errorMessage: null },
  ];
  const run = {
    ruleId: 1,
    at: new Date(AT.getTime() + 3 * MIN + 38_000),
    fireAt: AT,
    finishedAt: new Date(AT.getTime() + 4 * MIN + 19_000),
    triggerKind: "time",
    success: true,
    details: [{ actionId: 10, key, kind: "DEVICE", target: "Rolltor", ok: true }],
    errorMessage: null,
  };
  assert.equal(await recordHubRuleRuns(1, [run]), 1);
  // Noch einmal gemeldet (Antwort ging verloren): keine zweite Zeile.
  assert.equal(await recordHubRuleRuns(1, [run]), 1);
  assert.equal(world.runs.filter((r) => r.triggerKind === "hub:time").length, 1);
  // Der Termin bleibt derselbe: Vermerkt wird nur, was frueher steht, nie ein spaeterer Termin.
  const marks = world.ruleUpdates.filter((u) => "lastOccurrenceAt" in u.data);
  assert.ok(marks.length > 0);
  for (const m of marks) assert.equal((m.data.lastOccurrenceAt as Date).getTime(), AT.getTime());
  assert.equal((rule.lastOccurrenceAt as Date).getTime(), AT.getTime());
  // Der Cron sieht den Termin als erledigt und schaltet nichts.
  world.clock = new Date(AT.getTime() + 10 * MIN);
  const tick = await runRuleTick(world.clock);
  assert.deepEqual(tick.results, []);
});

// ─── Hub-Auftraege einer Zeit-Regel (Hue, Kamera steuern) ─────────────────────

const SCENE = { kind: "CAMERA", targetCameraId: 3, ptzPresetId: 1 };

/** Cron-Lauf zur Zeit `at`, der Hub meldet sich laufend (nichts angekuendigt). */
async function tickAt(at: Date) {
  world.clock = at;
  world.hub = heartbeat(at);
  return runRuleTick(at);
}

const timeRuns = () => world.runs.filter((r) => r.triggerKind === "time");
/** Vermerkter Termin der Regel (`lastOccurrenceAt`) als Zeitwert. */
const markOf = (r: Row) => (r.lastOccurrenceAt as Date | null)?.getTime() ?? null;

test("Hub-Auftrag offen: in Arbeit, kein zweiter Auftrag, Termin erst mit DONE erledigt", async () => {
  const rule = regel(1, { actions: [SCENE] });
  world.rules = [rule];
  let tick = await tickAt(new Date(AT.getTime() + 30_000));
  assert.equal(tick.results[0]?.kind, "termin");
  assert.equal(world.tasks.length, 1);
  assert.equal(markOf(rule), null);
  // Auftrag offen (auch nach Ablauf der Sperre): kein zweiter Auftrag, kein Vermerk.
  for (const m of [2, 5, 9]) {
    tick = await tickAt(new Date(AT.getTime() + m * MIN));
    assert.deepEqual(tick.results, []);
  }
  assert.equal(world.tasks.length, 1);
  assert.equal(timeRuns().length, 1);
  assert.equal(markOf(rule), null);
  // Der Hub meldet DONE: Der naechste Cron-Lauf traegt nach und vermerkt den Termin.
  world.tasks[0].status = "DONE";
  tick = await tickAt(new Date(AT.getTime() + 10 * MIN));
  assert.deepEqual(tick.results, []);
  assert.equal(timeRuns()[0].success, true);
  assert.equal(markOf(rule), AT.getTime());
  assert.equal(world.tasks.length, 1);
});

test("Hub-Auftrag gescheitert: Aktion fehlt wieder und wird nachgeholt; nach der Frist genau eine Meldung", async () => {
  const rule = regel(1, { actions: [SCENE] });
  world.rules = [rule];
  await tickAt(new Date(AT.getTime() + 30_000));
  world.tasks[0].status = "FAILED";
  world.tasks[0].error = "Kamera nicht erreichbar";
  // Nach der Sperre: nachgeholt, mit neuem Auftrag.
  let tick = await tickAt(new Date(AT.getTime() + 4 * MIN));
  assert.equal(tick.results[0]?.kind, "nachgeholt");
  assert.equal(world.tasks.length, 2);
  assert.equal((timeRuns()[0].details as Row[])[0].error, "Hub: Kamera nicht erreichbar");
  // Auch der zweite scheitert, der dritte bleibt offen bis Fristende.
  world.tasks[1].status = "FAILED";
  world.tasks[1].error = "Kamera nicht erreichbar";
  tick = await tickAt(new Date(AT.getTime() + 8 * MIN));
  assert.equal(tick.results[0]?.kind, "nachgeholt");
  assert.equal(world.tasks.length, 3);
  assert.equal(markOf(rule), null);
  const until = AT.getTime() + RULE_CATCH_UP_MS;
  tick = await tickAt(new Date(until + MIN));
  assert.equal(tick.results[0]?.kind, "verpasst");
  const missed = world.runs.filter((r) => r.triggerKind === "missed");
  assert.equal(missed.length, 1);
  assert.match(String(missed[0].errorMessage), /nicht ausgeführt/);
  assert.match(String(missed[0].errorMessage), /3 Versuche in 30 Minuten\. Letzter Fehler: .*Ein Hub-Auftrag blieb bis Fristende ohne Ergebnis\./);
  // Genau eine Meldung, auch wenn der letzte Auftrag spaeter noch gelingt.
  world.tasks[2].status = "DONE";
  tick = await tickAt(new Date(until + 10 * MIN));
  assert.deepEqual(tick.results, []);
  assert.equal(world.runs.filter((r) => r.triggerKind === "missed").length, 1);
  assert.equal(world.tasks.length, 3);
});

test("Hub-Auftrag verfallen (nicht abgeholt): wird auch neben einem anderen Fehler abgeglichen und nachgeholt", async () => {
  const actions = [SCENE, { kind: "CAMERA", targetCameraId: 4, ptzPresetId: 2 }];
  const rule = regel(1, { actions });
  world.rules = [rule];
  const keys = actionKeys(rule.actions as never);
  const [scene3, scene4] = (rule.actions as Row[]).map((a) => keys.get(a.id));
  // Lauf zum Termin: Kamera 3 an den Hub uebergeben, Kamera 4 war deaktiviert.
  world.tasks = [{ id: 500, accountId: 1, type: "CAMERA_SCENE", status: "PENDING", error: null }];
  world.runs = [
    {
      id: 1,
      accountId: 1,
      ruleId: 1,
      triggerKind: "time",
      triggeredAt: new Date(AT.getTime() + 20_000),
      success: false,
      details: [
        { actionId: 10, key: scene3, kind: "CAMERA", target: "Kamera 3", ok: false, pending: true, hubTaskId: 500 },
        { actionId: 11, key: scene4, kind: "CAMERA", target: "Kamera 4", ok: false, error: "Kamera ist deaktiviert" },
      ],
      errorMessage: "Kamera 4: Kamera ist deaktiviert",
    },
  ];
  rule.lastRunAt = new Date(AT.getTime() + 20_000);
  // Die Abholung setzt den Auftrag nach einer Minute auf FAILED (abgelaufen), ohne Ergebnis-Route.
  world.tasks[0].status = "FAILED";
  world.tasks[0].error = "abgelaufen";
  const tick = await tickAt(new Date(AT.getTime() + 5 * MIN));
  assert.equal(tick.results[0]?.kind, "nachgeholt");
  assert.equal((world.runs[0].details as Row[])[0].error, "Hub hat den Auftrag nicht rechtzeitig abgeholt");
  // Beide Aktionen fehlen und laufen neu, je mit eigenem Auftrag.
  const retry = timeRuns()[1];
  assert.deepEqual((retry.details as Row[]).map((d) => [d.key, d.pending]), [[scene3, true], [scene4, true]]);
  assert.equal(world.tasks.length, 3);
  // Beide gelingen: erledigt.
  for (const t of world.tasks.slice(1)) t.status = "DONE";
  await tickAt(new Date(AT.getTime() + 6 * MIN));
  assert.equal(markOf(rule), AT.getTime());
});

test("Zwei Mandanten: Lauf, Auftrag, Nachtrag und Vermerk je im eigenen Mandanten", async () => {
  const first = regel(1, { actions: [SCENE] });
  const second = regel(2, {
    accountId: 2,
    account: { id: 2, timezone: "Europe/Berlin", latitude: null, longitude: null },
    actions: [{ kind: "CAMERA", targetCameraId: 4, ptzPresetId: 2 }],
  });
  world.rules = [first, second];
  db.account.findMany = async () => [{ id: 1 }, { id: 2 }];
  let tick = await tickAt(new Date(AT.getTime() + 30_000));
  assert.deepEqual(tick.results.map((r) => r.kind), ["termin", "termin"]);
  assert.deepEqual(timeRuns().map((r) => [r.ruleId, r.accountId]), [[1, 1], [2, 2]]);
  assert.deepEqual(world.tasks.map((t) => t.accountId), [1, 2]);
  // Beide Auftraege fertig: Der Cron traegt je Mandant nach (update nach ID und Mandant) und vermerkt.
  for (const t of world.tasks) t.status = "DONE";
  tick = await tickAt(new Date(AT.getTime() + 10 * MIN));
  assert.deepEqual(tick.results, []);
  assert.deepEqual(timeRuns().map((r) => r.success), [true, true]);
  assert.equal(markOf(first), AT.getTime());
  assert.equal(markOf(second), AT.getTime());
  // Mit dem Mandanten des anderen findet ein update keine Zeile.
  await assert.rejects(db.roomRuleRun.update({ where: { id: timeRuns()[1].id as number, accountId: 1 }, data: { success: false } } as never));
  assert.equal(timeRuns()[1].success, true);
});

// ─── Sicherheitsnetz zum Betriebsende ────────────────────────────────────────

/** Betriebszeit an jedem Tag des Jahres, wie `ruleInclude` sie laedt. */
function schedule(name: string, opensAt: string, closesAt: string) {
  return {
    name,
    seasons: [{ name: "Ganzjährig", startMmDd: "01-01", endMmDd: "12-31", sortOrder: 0, periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt, closesAt })) }],
    exceptions: [],
  };
}

// Deaktiviert: Das Netz versucht zu schliessen, ohne dass ein Geraet angesprochen wird.
const NET_GATE = { ...GATE, isActive: false };
const openRun = (id: number, ruleId: number, at: Date): Row => ({
  id,
  accountId: 1,
  ruleId,
  triggerKind: "opening",
  triggeredAt: at,
  success: true,
  details: [{ actionId: ruleId * 10, key: "DEVICE:9:open", kind: "DEVICE", deviceId: 9, deviceAction: "open", ok: true }],
  errorMessage: null,
});
const netRuns = () => world.runs.filter((r) => r.triggerKind === "closing-net");

test("Sicherheitsnetz: Betriebsbeginn mit eigener Betriebszeit – kein Schliessen, solange dort Betrieb ist", async () => {
  // Betriebsende folgt dem Buero (8–16 Uhr), Betriebsbeginn der Halle (8–22 Uhr).
  const closing = regel(1, {
    trigger: "CLOSING",
    timeOfDay: null,
    operatingSchedule: schedule("Büro", "08:00", "16:00"),
    actions: [{ kind: "DEVICE", deviceId: 9, deviceAction: "close" }],
    lastOccurrenceAt: new Date("2026-11-27T15:00:00.000Z"),
    // Termin 16 Uhr gescheitert und gemeldet.
    lastMissedAt: new Date("2026-11-28T15:00:00.000Z"),
    lastRunAt: new Date("2026-11-28T15:00:30.000Z"),
  });
  const opening = regel(2, {
    trigger: "OPENING",
    timeOfDay: null,
    offsetMinutes: -15,
    operatingSchedule: schedule("Halle", "08:00", "22:00"),
    actions: [{ kind: "DEVICE", deviceId: 9, deviceAction: "open" }],
    lastOccurrenceAt: new Date("2026-11-28T06:45:00.000Z"),
  });
  world.rules = [closing, opening];
  world.devices = [NET_GATE];
  world.runs = [
    openRun(1, 2, new Date("2026-11-28T06:45:20.000Z")),
    {
      id: 2,
      accountId: 1,
      ruleId: 1,
      triggerKind: "closing",
      triggeredAt: new Date("2026-11-28T15:00:30.000Z"),
      success: false,
      details: [{ actionId: 10, key: "DEVICE:9:close", kind: "DEVICE", deviceId: 9, deviceAction: "close", ok: false, error: "Gerät offline" }],
      errorMessage: "Rolltor: Gerät offline",
    },
  ];
  // 17 Uhr: Das Buero hat seit einer Stunde zu, in der Halle ist Betrieb.
  let tick = await tickAt(new Date("2026-11-28T16:00:00.000Z"));
  assert.deepEqual(tick.results, []);
  // 21:45 Uhr: Halle noch offen.
  tick = await tickAt(new Date("2026-11-28T20:45:00.000Z"));
  assert.deepEqual(tick.results, []);
  assert.equal(netRuns().length, 0);
  // 22:31 Uhr: Seit 30 Minuten nirgends Betrieb, das Netz schliesst einmal (nur „zu“).
  tick = await tickAt(new Date("2026-11-28T21:31:00.000Z"));
  assert.deepEqual(tick.results.map((r) => r.kind), ["netz"]);
  assert.deepEqual(netRuns().map((r) => (r.details as Row[]).map((d) => d.deviceAction)), [["close"]]);
  tick = await tickAt(new Date("2026-11-28T21:45:00.000Z"));
  assert.deepEqual(tick.results, []);
  assert.equal(netRuns().length, 1);
});

test("Sicherheitsnetz: neu angelegte Regel „Betriebsende“ schliesst nicht nach einer Oeffnung von vor Tagen", async () => {
  // Angelegt Samstag 17:30 Uhr (Vermerk beim Anlegen); die letzte Oeffnung war Sonntag vor sechs Tagen.
  const created = new Date("2026-11-28T16:30:00.000Z");
  const closing = regel(1, {
    trigger: "CLOSING",
    timeOfDay: null,
    operatingSchedule: schedule("Büro", "08:00", "16:00"),
    actions: [{ kind: "DEVICE", deviceId: 9, deviceAction: "close" }],
    createdAt: created,
    lastOccurrenceAt: created,
  });
  const opening = regel(2, {
    trigger: "OPENING",
    timeOfDay: null,
    offsetMinutes: -15,
    daysOfWeek: 64,
    operatingSchedule: schedule("Büro", "08:00", "16:00"),
    actions: [{ kind: "DEVICE", deviceId: 9, deviceAction: "open" }],
    lastOccurrenceAt: new Date("2026-11-22T06:45:00.000Z"),
  });
  world.rules = [closing, opening];
  world.devices = [NET_GATE];
  world.runs = [openRun(1, 2, new Date("2026-11-22T06:45:20.000Z"))];
  let tick = await tickAt(new Date("2026-11-28T17:00:00.000Z"));
  assert.deepEqual(tick.results, []);
  assert.equal(netRuns().length, 0);
  // Eine Oeffnung nach dem Anlegen zaehlt wie bisher.
  world.runs.push(openRun(2, 2, new Date("2026-11-28T16:45:00.000Z")));
  tick = await tickAt(new Date("2026-11-28T17:20:00.000Z"));
  assert.deepEqual(tick.results.map((r) => r.kind), ["netz"]);
  assert.equal(netRuns().length, 1);
});

test("Sicherheitsnetz: Zeitplan nach der Oeffnung des Tages geaendert, Termin scheitert – das Netz schliesst trotzdem", async () => {
  // Geoeffnet um 7:45 Uhr; um 11 Uhr aendert jemand den Zeitplan der Regel „Betriebsende“ (neuer Vermerk).
  // Der Termin um 16 Uhr scheitert (Rolltor offline), danach ist kein Betrieb mehr.
  const closing = regel(1, {
    trigger: "CLOSING",
    timeOfDay: null,
    operatingSchedule: schedule("Büro", "08:00", "16:00"),
    actions: [{ kind: "DEVICE", deviceId: 9, deviceAction: "close" }],
    lastOccurrenceAt: new Date("2026-11-28T10:00:00.000Z"),
    configChangedAt: new Date("2026-11-28T10:00:00.000Z"),
    lastMissedAt: new Date("2026-11-28T15:00:00.000Z"),
    lastRunAt: new Date("2026-11-28T15:00:30.000Z"),
  });
  const opening = regel(2, {
    trigger: "OPENING",
    timeOfDay: null,
    offsetMinutes: -15,
    operatingSchedule: schedule("Büro", "08:00", "16:00"),
    actions: [{ kind: "DEVICE", deviceId: 9, deviceAction: "open" }],
    lastOccurrenceAt: new Date("2026-11-28T06:45:00.000Z"),
  });
  world.rules = [closing, opening];
  world.devices = [NET_GATE];
  world.runs = [
    openRun(1, 2, new Date("2026-11-28T06:45:20.000Z")),
    {
      id: 2,
      accountId: 1,
      ruleId: 1,
      triggerKind: "closing",
      triggeredAt: new Date("2026-11-28T15:00:30.000Z"),
      success: false,
      details: [{ actionId: 10, key: "DEVICE:9:close", kind: "DEVICE", deviceId: 9, deviceAction: "close", ok: false, error: "Gerät offline" }],
      errorMessage: "Rolltor: Gerät offline",
    },
  ];
  // 16:31 Uhr: Die Oeffnung von heute frueh zaehlt weiter, das Netz schliesst einmal.
  let tick = await tickAt(new Date("2026-11-28T15:31:00.000Z"));
  assert.deepEqual(tick.results.map((r) => r.kind), ["netz"]);
  assert.deepEqual(netRuns().map((r) => (r.details as Row[]).map((d) => d.deviceAction)), [["close"]]);
  tick = await tickAt(new Date("2026-11-28T15:45:00.000Z"));
  assert.deepEqual(tick.results, []);
  assert.equal(netRuns().length, 1);
});

// ─── Wiederholung im Notbetrieb ──────────────────────────────────────────────

test("Wiederholung des Hubs (nur, was noch fehlte): Termin erst erledigt, wenn alle Laeufe zusammen jede Aktion geschafft haben", async () => {
  const rule = regel(1, {
    actions: [
      { kind: "DEVICE", deviceId: 7, deviceAction: "deactivate" },
      { kind: "NOTIFY", channel: "PUSH" },
    ],
  });
  world.rules = [rule];
  const keys = actionKeys(rule.actions as never);
  const [lightOff, notify] = (rule.actions as Row[]).map((a) => keys.get(a.id) as string);
  const hubRun = (at: number, details: Array<Record<string, unknown>>) => ({
    ruleId: 1,
    at: new Date(at),
    fireAt: AT,
    finishedAt: new Date(at + 2_000),
    triggerKind: "time",
    success: details.every((d) => d.ok === true),
    details,
    errorMessage: null,
  });
  const marked = () => world.ruleUpdates.some((u) => "lastOccurrenceAt" in u.data && u.data.lastOccurrenceAt instanceof Date);
  // Erster Lauf im Notbetrieb: Licht aus scheitert im LAN, Benachrichtigen braucht die Cloud.
  await recordHubRuleRuns(1, [
    hubRun(AT.getTime() + 4 * MIN, [
      { actionId: 10, key: lightOff, kind: "DEVICE", target: "Licht", ok: false, error: "Zeitüberschreitung" },
      { actionId: 11, key: notify, kind: "NOTIFY", target: "NOTIFY", ok: false, error: "Im Notbetrieb nicht möglich (braucht die Cloud)" },
    ]),
  ]);
  // Zweiter Versuch, nur Licht aus: gelingt. Der Lauf allein ist erfolgreich, der Termin nicht.
  await recordHubRuleRuns(1, [hubRun(AT.getTime() + 5 * MIN, [{ actionId: 10, key: lightOff, kind: "DEVICE", target: "Licht", ok: true }])]);
  assert.equal(world.runs.filter((r) => r.triggerKind === "hub:time").length, 2);
  assert.equal(marked(), false);
  assert.equal(rule.lastOccurrenceAt, null);
  // Die Cloud holt die Benachrichtigung nach; danach ist der Termin erledigt.
  world.runs.push({
    id: 99,
    accountId: 1,
    ruleId: 1,
    triggerKind: "time",
    triggeredAt: new Date(AT.getTime() + 9 * MIN),
    success: true,
    details: [{ actionId: 11, key: notify, kind: "NOTIFY", ok: true }],
    errorMessage: null,
  });
  // Der naechste Cron-Lauf sieht alle Aktionen gelungen und vermerkt den Termin, ohne etwas zu schalten.
  const tick = await tickAt(new Date(AT.getTime() + 10 * MIN));
  assert.deepEqual(tick.results, []);
  assert.equal(markOf(rule), AT.getTime());
});
