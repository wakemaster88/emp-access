import { test } from "node:test";
import assert from "node:assert/strict";
import { BurstLights, type LightDriver } from "./vehicle-light.js";

/** Alles Anstehende ablaufen lassen. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Attrappen für Kamera, Platte und Beenden. `steps` hält fest, was in welcher Reihenfolge geschah. */
function setup(opts: { maxMs?: number; markWaitMs?: number } = {}) {
  const steps: string[] = [];
  const logged: string[] = [];
  const cleanups = new Map<string, () => Promise<void>>();
  const state = {
    exiting: false,
    /** Licht an der Kamera. */
    light: 0,
    marks: new Map<number, number>(),
    /** Die Kamera lehnt den nächsten Befehl mit diesem Fehler ab. */
    failOn: null as Error | null,
    failOff: null as Error | null,
    /** Solange offen, bleibt der Einschalt-Befehl bzw. das Schreiben oder Löschen des Merkers unterwegs. */
    holdOn: null as Promise<void> | null,
    holdMark: null as Promise<void> | null,
    holdUnmark: null as Promise<void> | null,
  };
  const driver: LightDriver = {
    mark: async (cameraId, at) => {
      // Der Schritt zaehlt, sobald der Merker auf der Platte steht.
      await (state.holdMark ?? settle());
      state.marks.set(cameraId, at);
      steps.push(`merken ${cameraId}`);
    },
    unmark: async (cameraId, at) => {
      // Der Schritt zaehlt, sobald der Merker von der Platte ist.
      if (state.holdUnmark) await state.holdUnmark;
      steps.push(`merker weg ${cameraId}`);
      if (state.marks.get(cameraId) === at) state.marks.delete(cameraId);
    },
    onShutdown: (name, fn) => {
      steps.push(`anmelden ${name}`);
      cleanups.set(name, fn);
      return () => {
        if (cleanups.get(name) !== fn) return;
        cleanups.delete(name);
        steps.push(`abmelden ${name}`);
      };
    },
    isExiting: () => state.exiting,
    log: (msg) => logged.push(msg),
  };
  const lights = new BurstLights(driver, { maxMs: opts.maxMs ?? 60_000, markWaitMs: opts.markWaitMs ?? 250 });
  const light = {
    cameraId: 3,
    name: "Eingang",
    switchLight: async (on: boolean) => {
      steps.push(on ? "an" : "aus");
      if (on) {
        if (state.holdOn) await state.holdOn;
        if (state.failOn) throw state.failOn;
      } else if (state.failOff) {
        throw state.failOff;
      }
      state.light = on ? 1 : 0;
    },
  };
  return { lights, light, steps, logged, cleanups, state };
}

test("Weißlicht: Aufräumer und Merker stehen, bevor der Einschalt-Befehl an die Kamera geht", async () => {
  const { lights, light, steps, cleanups, state } = setup();
  const off = await lights.switchOn(light);
  assert.deepEqual(steps, ["anmelden weisslicht:3", "merken 3", "an"]);
  assert.equal(state.light, 1);
  assert.equal(state.marks.has(3), true);
  assert.equal(cleanups.has("weisslicht:3"), true);
  assert.equal(lights.isOn(3), true);
  await off?.();
});

test("Weißlicht: nach dem Burst aus, Merker weg, Aufräumer abgemeldet – ein Befehl, wer auch immer ausschaltet", async () => {
  const { lights, light, steps, logged, cleanups, state } = setup();
  const off = await lights.switchOn(light);
  assert.ok(off);
  steps.length = 0;
  // Burst-Ende und Beenden des Hubs im selben Augenblick.
  await Promise.all([off(), off(), cleanups.get("weisslicht:3")?.()]);
  assert.deepEqual(steps, ["aus", "merker weg 3", "abmelden weisslicht:3"]);
  assert.equal(state.light, 0);
  assert.equal(state.marks.size, 0);
  assert.equal(cleanups.size, 0);
  assert.equal(lights.isOn(3), false);
  assert.deepEqual(logged, ["Fahrzeug-Burst Eingang: Weißlicht aus"]);
});

test("Weißlicht: solange der Hub endet, geht keines mehr an", async () => {
  const { lights, light, steps, state } = setup();
  state.exiting = true;
  assert.equal(await lights.switchOn(light), null);
  // Nichts angemeldet, nichts gemerkt, kein Befehl an die Kamera.
  assert.deepEqual(steps, []);
  assert.equal(lights.isOn(3), false);
});

test("Weißlicht: beginnt das Beenden, während der Merker geschrieben wird, bleibt das Licht aus", async () => {
  const { lights, light, steps, cleanups, state } = setup();
  let markDone: () => void = () => undefined;
  state.holdMark = new Promise<void>((resolve) => (markDone = resolve));
  const pending = lights.switchOn(light);
  state.exiting = true;
  const cleanup = cleanups.get("weisslicht:3")?.();
  markDone();
  assert.equal(await pending, null);
  await cleanup;
  assert.equal(steps.includes("an"), false);
  assert.equal(steps.includes("aus"), false);
  assert.equal(state.marks.size, 0);
  assert.equal(cleanups.size, 0);
  assert.equal(lights.isOn(3), false);
});

test("Weißlicht: Beenden, während der Einschalt-Befehl unterwegs ist – „aus“ geht erst danach an die Kamera", async () => {
  const { lights, light, steps, cleanups, state } = setup();
  let onDone: () => void = () => undefined;
  state.holdOn = new Promise<void>((resolve) => (onDone = resolve));
  const pending = lights.switchOn(light);
  await settle();
  assert.deepEqual(steps, ["anmelden weisslicht:3", "merken 3", "an"]);
  const cleanup = cleanups.get("weisslicht:3")?.();
  await settle();
  // Kaeme „aus“ vor „an“ bei der Kamera an, bliebe das Licht an.
  assert.equal(steps.includes("aus"), false);
  onDone();
  await cleanup;
  assert.deepEqual(steps.slice(2), ["an", "aus", "merker weg 3", "abmelden weisslicht:3"]);
  assert.equal(state.light, 0);
  assert.equal(state.marks.size, 0);
  // Der Burst bekommt seine Ausschalt-Funktion noch; sie schaltet kein zweites Mal.
  const off = await pending;
  await off?.();
  assert.equal(steps.filter((s) => s === "aus").length, 1);
});

test("Weißlicht: das Beenden wartet, bis der Merker von der Platte ist – das Ende des Bursts nicht", async () => {
  const { lights, light, steps, cleanups, state } = setup();
  const off = await lights.switchOn(light);
  let unmarkDone: () => void = () => undefined;
  state.holdUnmark = new Promise<void>((resolve) => (unmarkDone = resolve));
  let cleaned = false;
  const cleanup = cleanups.get("weisslicht:3")?.().then(() => {
    cleaned = true;
  });
  await settle();
  // Das Licht ist aus, der Merker steht noch. Bliebe er ueber das Prozessende
  // stehen, schaltete der naechste Start ein Licht aus, das inzwischen jemand
  // von Hand eingeschaltet hat: Der Aufraeumer ist deshalb noch nicht fertig.
  assert.equal(state.light, 0);
  assert.equal(state.marks.has(3), true);
  assert.equal(cleaned, false);
  // Der Burst wartet nicht auf die Platte.
  await off?.();
  await settle();
  assert.equal(cleaned, false);
  unmarkDone();
  await cleanup;
  assert.equal(cleaned, true);
  assert.equal(state.marks.size, 0);
  assert.deepEqual(steps.slice(3), ["aus", "abmelden weisslicht:3", "merker weg 3"]);
});

test("Weißlicht: schaltet die Kamera nicht aus, bleibt der Merker, und das Beenden meldet es", async () => {
  const { lights, light, logged, cleanups, state } = setup();
  const off = await lights.switchOn(light);
  state.failOff = new Error("HTTP 503");
  await assert.rejects(async () => cleanups.get("weisslicht:3")?.(), /nicht ausgeschaltet/);
  assert.equal(state.light, 1);
  assert.equal(state.marks.has(3), true);
  // Frei fuers Nachholen: Der Burst haelt das Licht nicht mehr.
  assert.equal(lights.isOn(3), false);
  assert.equal(cleanups.size, 0);
  assert.deepEqual(logged, ["Fahrzeug-Burst Eingang: Weißlicht aus fehlgeschlagen: HTTP 503 – wird nachgeholt"]);
  // Das Ende des Bursts scheitert daran nicht.
  await off?.();
});

test("Weißlicht: schaltet die Kamera nicht ein, bleibt der Merker – ob es brennt, ist offen", async () => {
  const { lights, light, steps, cleanups, state } = setup();
  state.failOn = new Error("The operation was aborted due to timeout");
  await assert.rejects(lights.switchOn(light), /timeout/);
  assert.deepEqual(steps, ["anmelden weisslicht:3", "merken 3", "an", "abmelden weisslicht:3"]);
  assert.equal(state.marks.has(3), true);
  assert.equal(cleanups.size, 0);
  assert.equal(lights.isOn(3), false);
});

test("Weißlicht: ruft niemand das Ausschalten, geht es nach der Höchstdauer von selbst aus", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { lights, light, state } = setup({ maxMs: 60_000 });
  await lights.switchOn(light);
  t.mock.timers.tick(59_999);
  await settle();
  assert.equal(state.light, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(state.light, 0);
  assert.equal(state.marks.size, 0);
  assert.equal(lights.isOn(3), false);
});

test("Weißlicht: braucht die Platte zu lange, wartet das Einschalten nur die Frist auf den Merker", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { lights, light, steps, state } = setup({ markWaitMs: 250 });
  state.holdMark = new Promise<void>(() => undefined);
  const pending = lights.switchOn(light);
  t.mock.timers.tick(249);
  await settle();
  assert.equal(steps.includes("an"), false);
  t.mock.timers.tick(1);
  const off = await pending;
  assert.equal(state.light, 1);
  await off?.();
  assert.equal(state.light, 0);
});
