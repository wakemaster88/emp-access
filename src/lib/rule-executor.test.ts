import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedAt,
  cooldownFree,
  decideExecutor,
  type ExecutorAction,
  type ExecutorContext,
  type ExecutorDevice,
} from "./rule-executor";
import { ALLOWED_CASES, COOLDOWN_CASES } from "../../hub/src/motion-local-cases";

// Dieselben Faelle prueft der Hub (hub/src/motion-rules.test.ts).
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

const shelly = (category: string | null, ipAddress: string | null = "192.168.1.40"): ExecutorDevice => ({
  type: "SHELLY",
  category,
  ipAddress,
  hueBridgeId: null,
  hueLightId: null,
  isActive: true,
});
const devices = new Map<number, ExecutorDevice>([
  [1, shelly("BELEUCHTUNG")],
  [2, shelly("SCHALTER")],
  [3, shelly("TUER")],
  [4, shelly("ROLLTOR")],
  [5, shelly(null)],
  [6, shelly("BELEUCHTUNG", null)],
  [7, { type: "HUE_LIGHT", category: "BELEUCHTUNG", ipAddress: null, hueBridgeId: "b", hueLightId: "3", isActive: true }],
  [8, { type: "HUE_LIGHT", category: "BELEUCHTUNG", ipAddress: null, hueBridgeId: null, hueLightId: null, isActive: true }],
  [9, { ...shelly("BELEUCHTUNG"), isActive: false }],
  [10, { type: "DOORBIRD", category: null, ipAddress: "192.168.1.41", hueBridgeId: null, hueLightId: null, isActive: true }],
  [11, { type: "DREHKREUZ", category: null, ipAddress: "192.168.1.42", hueBridgeId: null, hueLightId: null, isActive: true }],
  [12, shelly("TASTER")],
  [13, shelly("MARKISE")],
  // Kategorie Schalter, aber kein Shelly: der Hub schaltet es nicht im LAN.
  [14, { type: "RASPBERRY_PI", category: "SCHALTER", ipAddress: "192.168.1.43", hueBridgeId: null, hueLightId: null, isActive: true }],
  [15, { type: "GARDENA_VALVE", category: "BELEUCHTUNG", ipAddress: "192.168.1.44", hueBridgeId: null, hueLightId: null, isActive: true }],
]);
const ctx: ExecutorContext = { devices, switchTriggers: new Set([2]) };
const dev = (deviceId: number, deviceAction = "open"): ExecutorAction => ({ kind: "DEVICE", deviceId, deviceAction, targetCameraId: null });
const cam: ExecutorAction = { kind: "CAMERA", deviceId: null, deviceAction: null, targetCameraId: 5 };
const motion = (actions: ExecutorAction[], extra: Record<string, unknown> = {}) => ({
  trigger: "MOTION",
  operating: "ANY",
  operatingExtent: "SELF",
  actions,
  ...extra,
});

test("decideExecutor: Licht, Hue und Kamera-Szene darf der Hub selbst ausführen", () => {
  assert.deepEqual(decideExecutor(motion([dev(1)]), ctx), { by: "hub" });
  assert.deepEqual(decideExecutor(motion([dev(1, "deactivate")]), ctx), { by: "hub" });
  assert.deepEqual(decideExecutor(motion([dev(7)]), ctx), { by: "hub" });
  assert.deepEqual(decideExecutor(motion([cam]), ctx), { by: "hub" });
  assert.deepEqual(decideExecutor(motion([dev(1), dev(7, "deactivate"), cam]), ctx), { by: "hub" });
  assert.deepEqual(decideExecutor(motion([dev(1)], { operating: "OPEN", operatingExtent: "SUBPROFILES" }), ctx), { by: "hub" });
});

test("decideExecutor: alles andere bleibt in der Cloud, die ganze Regel", () => {
  const cloud = (rule: Parameters<typeof decideExecutor>[0]) => decideExecutor(rule, ctx).by;
  assert.equal(cloud(motion([])), "cloud", "keine Aktion");
  assert.equal(cloud({ ...motion([dev(1)]), trigger: "TIME" }), "cloud", "keine Bewegungs-Regel");
  for (const id of [3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 99]) assert.equal(cloud(motion([dev(id)])), "cloud", `Gerät ${id}`);
  assert.deepEqual(decideExecutor(motion([dev(14)]), ctx), { by: "cloud", reason: "Gerät RASPBERRY_PI nur über die Cloud" });
  assert.equal(cloud(motion([dev(1), dev(3)])), "cloud", "Licht und Türöffner");
  assert.equal(cloud(motion([dev(2)])), "cloud", "Schalter löst eine Regel „Gerät geschaltet“ aus");
  for (const act of ["close", "stop", "emergency", "reset"]) assert.equal(cloud(motion([dev(1, act)])), "cloud", act);
  for (const kind of ["NOTIFY", "AUDIO"]) {
    assert.equal(cloud(motion([{ kind, deviceId: null, deviceAction: null, targetCameraId: null }])), "cloud", kind);
  }
  assert.equal(cloud(motion([{ ...cam, targetCameraId: null }])), "cloud", "Szene ohne Kamera");
  assert.equal(cloud(motion([dev(1)], { operating: "OPEN", operatingExtent: "BOOKED_SUBPROFILES" })), "cloud", "gebuchte Termine");
});
