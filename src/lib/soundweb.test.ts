import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatControlValue,
  formatGainDb,
  formatHiqnetAddress,
  gainDbToRaw,
  gainRawToDb,
  parseHiqnetAddress,
  parseStateVariable,
  percentToRaw,
  rawToPercent,
  soundwebSetPayload,
} from "./soundweb";

test("Gain-Law: linearer Teil zwischen -10 und +10 dB", () => {
  assert.equal(gainDbToRaw(0), 0);
  assert.equal(gainDbToRaw(10), 100_000);
  assert.equal(gainDbToRaw(-10), -100_000);
  assert.equal(gainDbToRaw(-3.5), -35_000);
  assert.equal(gainRawToDb(-35_000), -3.5);
});

test("Gain-Law: logarithmischer Teil unter -10 dB (Werte aus dem DI Kit)", () => {
  // -20 dB: -log10(2) * 200000 - 100000 = -160206
  assert.equal(gainDbToRaw(-20), -160_206);
  // -80 dB („-inf“ am Fader): -280618
  assert.equal(gainDbToRaw(-80), -280_618);
  for (const db of [-11, -20, -45.5, -80]) {
    const back = gainRawToDb(gainDbToRaw(db));
    assert.ok(Math.abs(back - db) < 0.01, `${db} dB -> ${back}`);
  }
});

test("Prozent: mal 65536, in beide Richtungen", () => {
  assert.equal(percentToRaw(100), 6_553_600);
  assert.equal(percentToRaw(50), 3_276_800);
  assert.equal(percentToRaw(150), 6_553_600);
  assert.equal(rawToPercent(3_276_800), 50);
});

test("HiQnet-Adresse aus Audio Architect (12 Hex-Stellen)", () => {
  const a = parseHiqnetAddress("0x083203000100");
  assert.deepEqual(a, { node: 0x0832, virtualDevice: 3, objectId: 0x100, stateVariable: null });
  const b = parseHiqnetAddress("0001030001000000");
  assert.deepEqual(b, { node: 1, virtualDevice: 3, objectId: 0x100, stateVariable: 0 });
});

test("HiQnet-Adresse als Objekt allein oder in Teilen", () => {
  assert.deepEqual(parseHiqnetAddress("0x000100"), {
    node: null,
    virtualDevice: 3,
    objectId: 0x100,
    stateVariable: null,
  });
  assert.deepEqual(parseHiqnetAddress("0x0832, 0x03, 0x000100, 1"), {
    node: 0x832,
    virtualDevice: 3,
    objectId: 0x100,
    stateVariable: 1,
  });
  assert.deepEqual(parseHiqnetAddress("1 3 256"), {
    node: 1,
    virtualDevice: 3,
    objectId: 256,
    stateVariable: null,
  });
  assert.ok("error" in parseHiqnetAddress(""));
  assert.ok("error" in parseHiqnetAddress("0x12345"));
  assert.ok("error" in parseHiqnetAddress("a,b"));
});

test("State Variable dezimal oder hex", () => {
  assert.equal(parseStateVariable("1"), 1);
  assert.equal(parseStateVariable("0x0006"), 6);
  assert.equal(parseStateVariable(12), 12);
  assert.ok(typeof parseStateVariable("70000") === "object");
  assert.ok(typeof parseStateVariable("x") === "object");
});

test("Adresse formatieren", () => {
  assert.equal(formatHiqnetAddress(0x832, 3, 0x100), "0x083203000100");
});

test("Anzeige der Werte", () => {
  const gain = { kind: "GAIN" as const, minDb: -80, maxDb: 10, options: null };
  assert.equal(formatControlValue(gain, 0), "0,0 dB");
  assert.equal(formatControlValue(gain, 100_000), "+10,0 dB");
  assert.equal(formatControlValue(gain, -280_618), "−∞ dB");
  assert.equal(formatGainDb(-12.26, -80), "-12,5 dB");
  assert.equal(formatControlValue({ ...gain, kind: "MUTE" }, 1), "Stumm");
  assert.equal(formatControlValue({ ...gain, kind: "PERCENT" }, 3_276_800), "50 %");
  assert.equal(
    formatControlValue(
      { ...gain, kind: "SELECT", options: [{ value: 2, label: "Mikrofon" }] },
      2
    ),
    "Mikrofon"
  );
  assert.equal(formatControlValue({ ...gain, kind: "PRESET" }, null), null);
});

test("Sollwerte in Hub-Payload uebersetzen", () => {
  const gain = { kind: "GAIN" as const, minDb: -80, maxDb: 10, options: null };
  assert.deepEqual(soundwebSetPayload(gain, -6), { raw: -60_000 });
  // Ausserhalb des Reglerbereichs wird begrenzt, nicht abgelehnt.
  assert.deepEqual(soundwebSetPayload(gain, 40), { raw: 100_000 });
  assert.deepEqual(soundwebSetPayload({ ...gain, kind: "MUTE" }, true), { raw: 1 });
  assert.deepEqual(soundwebSetPayload({ ...gain, kind: "PERCENT" }, 42.5), { percent: 42.5 });
  assert.deepEqual(
    soundwebSetPayload({ ...gain, kind: "SELECT", options: [{ value: 1, label: "A" }] }, 1),
    { raw: 1 }
  );
  assert.ok(
    "error" in soundwebSetPayload({ ...gain, kind: "SELECT", options: [{ value: 1, label: "A" }] }, 7)
  );
  assert.deepEqual(soundwebSetPayload({ ...gain, kind: "PRESET" }, undefined), { preset: true });
});
