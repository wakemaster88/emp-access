import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIRECT_ABORTED_ERROR,
  allowedAt,
  cooldownFree,
  directRunLine,
  directRunOutcome,
  localMotionDecision,
  runActionsUntil,
  type LocalDevice,
  type LocalMotionInput,
  type LocalPlanRule,
} from "./motion-rules.js";
import { ALLOWED_CASES, COOLDOWN_CASES } from "./motion-local-cases.js";

// Dieselben Faelle prueft die Cloud (src/lib/rule-executor.test.ts).
for (const c of COOLDOWN_CASES) {
  test(`cooldownFree: ${c.name}`, () => {
    assert.equal(cooldownFree(c.lastRunAt, c.cooldownSeconds, c.at), c.free);
  });
}
for (const c of ALLOWED_CASES) {
  test(`allowedAt: ${c.name}`, () => {
    assert.equal(allowedAt(c.intervals, c.at), c.allowed);
  });
}

const AT = Date.parse("2026-11-28T18:00:00.000Z");
const devices: Record<number, LocalDevice> = {
  1: { type: "SHELLY", category: "BELEUCHTUNG", ipAddress: "192.168.1.50", isActive: true },
  2: { type: "HUE_LIGHT", category: "BELEUCHTUNG", ipAddress: null, hueBridgeId: "b", hueLightId: "4" },
  3: { type: "SHELLY", category: "TUER", ipAddress: "192.168.1.51" },
};

function rule(extra: Partial<LocalPlanRule> = {}): LocalPlanRule {
  return {
    id: 7,
    name: "Licht Hof",
    trigger: "MOTION",
    eventType: "PERSON",
    cooldownSeconds: 120,
    hubLocal: true,
    hubCameraIds: [4],
    allowedExact: [{ from: "2026-11-28T16:00:00.000Z", to: "2026-11-28T22:00:00.000Z" }],
    lastRunAt: null,
    hubConfigAt: "2026-11-20T09:15:00.000Z",
    actions: [{ kind: "DEVICE", deviceId: 1, deviceAction: "open" }],
    ...extra,
  };
}

function input(extra: Partial<LocalMotionInput> = {}): LocalMotionInput {
  return {
    cameraId: 4,
    type: "PERSON",
    at: AT,
    enabled: true,
    fromCamera: true,
    planFresh: true,
    lastRun: () => null,
    device: (id) => devices[id] ?? null,
    cameraKnown: (id) => id === 9,
    ...extra,
  };
}

const ids = (d: ReturnType<typeof localMotionDecision>) => ({
  run: d.run.map((r) => r.id),
  declined: d.declined.map((x) => x.rule.id),
});

test("localMotionDecision: markierte Regel mit Licht, Hue und Szene fuehrt der Hub selbst aus", () => {
  const r = rule({
    actions: [
      { kind: "DEVICE", deviceId: 1, deviceAction: "open" },
      { kind: "DEVICE", deviceId: 2, deviceAction: "deactivate" },
      { kind: "CAMERA", deviceId: null, deviceAction: null, targetCameraId: 9 },
    ],
  });
  assert.deepEqual(ids(localMotionDecision([r], input())), { run: [7], declined: [] });
});

test("aeltere Cloud ohne Markierung: der Hub fuehrt nichts aus und merkt nichts", () => {
  const { hubLocal: _hubLocal, hubCameraIds: _cams, allowedExact: _allowed, hubConfigAt: _cfg, ...old } = rule();
  assert.deepEqual(ids(localMotionDecision([old], input())), { run: [], declined: [] });
  assert.deepEqual(ids(localMotionDecision([rule({ hubLocal: false })], input())), { run: [], declined: [] });
});

test("passt nicht: andere Kamera, Ereignisart, ausserhalb der Zeitraeume, Abklingzeit", () => {
  assert.deepEqual(ids(localMotionDecision([rule()], input({ cameraId: 5 }))), { run: [], declined: [] });
  assert.deepEqual(ids(localMotionDecision([rule()], input({ type: "VEHICLE" }))), { run: [], declined: [] });
  assert.deepEqual(ids(localMotionDecision([rule()], input({ at: Date.parse("2026-11-28T22:00:00.000Z") }))), {
    run: [],
    declined: [],
  });
  // Abklingzeit: eigener Lauf oder der Lauf laut Plan, der juengere zaehlt.
  assert.deepEqual(ids(localMotionDecision([rule()], input({ lastRun: () => AT - 60_000 }))), { run: [], declined: [] });
  assert.deepEqual(ids(localMotionDecision([rule({ lastRunAt: new Date(AT - 60_000).toISOString() })], input())), {
    run: [],
    declined: [],
  });
  assert.deepEqual(
    ids(localMotionDecision([rule({ lastRunAt: new Date(AT - 600_000).toISOString() })], input({ lastRun: () => AT - 30_000 }))),
    { run: [], declined: [] },
  );
  assert.deepEqual(ids(localMotionDecision([rule({ lastRunAt: new Date(AT - 600_000).toISOString() })], input())), {
    run: [7],
    declined: [],
  });
});

test("passt, aber die Cloud fuehrt aus: Schalter aus, DoorBird, Plan alt, Geraet fehlt oder nur ueber die Cloud", () => {
  const declined = (r: LocalPlanRule, i: LocalMotionInput) => {
    const d = localMotionDecision([r], i);
    assert.equal(d.run.length, 0);
    return d.declined[0]?.reason;
  };
  assert.match(declined(rule(), input({ enabled: false })) ?? "", /HUB_RULES_LOCAL_MOTION/);
  assert.match(declined(rule(), input({ fromCamera: false })) ?? "", /DoorBird/);
  assert.match(declined(rule(), input({ planFresh: false })) ?? "", /Plan/);
  assert.match(declined(rule({ hubConfigAt: undefined }), input()) ?? "", /Stand/);
  assert.match(declined(rule({ actions: [] }), input()) ?? "", /keine Aktion/);
  assert.match(declined(rule({ actions: [{ kind: "DEVICE", deviceId: 8, deviceAction: "open" }] }), input()) ?? "", /unbekannt/);
  assert.match(declined(rule({ actions: [{ kind: "DEVICE", deviceId: 3, deviceAction: "open" }] }), input()) ?? "", /Cloud/);
  assert.match(declined(rule({ actions: [{ kind: "DEVICE", deviceId: 1, deviceAction: "close" }] }), input()) ?? "", /Cloud/);
  assert.match(declined(rule({ actions: [{ kind: "NOTIFY", deviceId: null, deviceAction: null }] }), input()) ?? "", /Cloud/);
  assert.match(
    declined(rule({ actions: [{ kind: "CAMERA", deviceId: null, deviceAction: null, targetCameraId: 12 }] }), input()) ?? "",
    /Kamera/,
  );
  assert.match(
    declined(rule(), input({ device: () => ({ type: "SHELLY", category: "BELEUCHTUNG", ipAddress: "192.168.1.50", isActive: false }) })) ?? "",
    /unbekannt/,
  );
});

test("directRunLine: Kamera, Ereignisart und Dauer bis zum Schalten", () => {
  assert.equal(
    directRunLine("Licht Hof", "Einfahrt", "PERSON", 412, 180),
    "Regel „Licht Hof“ vom Hub ausgeführt: Einfahrt, Person, 0,4 s vom Ereignis bis geschaltet (Lauf 0,2 s)",
  );
  assert.equal(directRunLine("X", "Kamera #4", "", 1500, 900), "Regel „X“ vom Hub ausgeführt: Kamera #4, Ereignis, 1,5 s vom Ereignis bis geschaltet (Lauf 0,9 s)");
});

test("directRunOutcome: nur ein ganzer Lauf in der Frist geht mit dem Ereignis, sonst fuehrt die Cloud aus", () => {
  const ok = { ok: true };
  const bad = { ok: false };
  assert.deepEqual(directRunOutcome([ok, ok], false), { report: true, record: true, handedOver: false });
  // Teilweise gelungen: Die Cloud fuehrt die Regel aus, der Lauf des Hubs steht im Verlauf.
  assert.deepEqual(directRunOutcome([ok, bad], false), { report: false, record: true, handedOver: true });
  // Nichts geschaltet: kein Eintrag, die Cloud fuehrt aus.
  assert.deepEqual(directRunOutcome([bad, bad], false), { report: false, record: false, handedOver: true });
  assert.deepEqual(directRunOutcome([], false), { report: false, record: false, handedOver: true });
  // Nach der Frist: nie mit dem Ereignis, auch wenn alles gelang.
  assert.deepEqual(directRunOutcome([ok, ok], true), { report: false, record: true, handedOver: true });
  const aborted: { ok: boolean; error?: string } = { ok: false, error: DIRECT_ABORTED_ERROR };
  assert.deepEqual(directRunOutcome([ok, aborted], true), {
    report: false,
    record: true,
    handedOver: true,
  });
});

test("runActionsUntil: nach Ablauf der Frist startet keine Aktion mehr, die laufende endet noch", async () => {
  let late = false;
  const started: number[] = [];
  const details = await runActionsUntil(
    [1, 2, 3],
    () => late,
    async (n) => {
      started.push(n);
      // Waehrend Aktion 2 laeuft, endet die Frist.
      if (n === 2) late = true;
      return { n, ok: true };
    },
    (n) => ({ n, ok: false, error: DIRECT_ABORTED_ERROR }),
  );
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(details, [
    { n: 1, ok: true },
    { n: 2, ok: true },
    { n: 3, ok: false, error: DIRECT_ABORTED_ERROR },
  ]);
  // Frist schon vorbei: nichts startet.
  const none = await runActionsUntil([1, 2], () => true, async () => assert.fail("gestartet"), (n) => n);
  assert.deepEqual(none, [1, 2]);
  assert.deepEqual(await runActionsUntil([], () => false, async (n: number) => n, (n) => n), []);
});
