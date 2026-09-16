import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIVE_STALE_AFTER_MS,
  PcmDownsampler,
  int16ToLittleEndian,
  isLiveSessionOpen,
  meterLevel,
} from "./audio-live";

test("Heruntertakten: 48 kHz ergibt genau ein Drittel der Samples, auch über viele Aufrufe", () => {
  const sampler = new PcmDownsampler(48_000, 16_000);
  let total = 0;
  for (let i = 0; i < 100; i++) total += sampler.push(new Float32Array(128)).length;
  assert.equal(total, Math.floor((100 * 128) / 3));
});

test("Heruntertakten: 44,1 kHz läuft über eine Minute nicht davon", () => {
  const sampler = new PcmDownsampler(44_100, 16_000);
  let total = 0;
  // Gut eine Minute in 128er-Blöcken, wie sie ein AudioWorklet liefert.
  const blocks = Math.ceil((44_100 * 60) / 128);
  for (let i = 0; i < blocks; i++) total += sampler.push(new Float32Array(128)).length;
  const expected = Math.floor((blocks * 128 * 16_000) / 44_100);
  assert.ok(Math.abs(total - expected) <= 1, `erwartet ~${expected}, erhalten ${total}`);
});

test("Heruntertakten: Pegel und Vorzeichen bleiben erhalten, Übersteuerung wird begrenzt", () => {
  const sampler = new PcmDownsampler(48_000, 16_000);
  assert.deepEqual([...sampler.push(new Float32Array([0.5, 0.5, 0.5, -1, -1, -1, 2, 2, 2]))], [
    16384, -32768, 32767,
  ]);
});

test("Heruntertakten: niedrigere Eingangsrate wiederholt Samples statt sie zu verlieren", () => {
  const sampler = new PcmDownsampler(8_000, 16_000);
  assert.equal(sampler.push(new Float32Array(100)).length, 200);
});

test("PCM-Bytes sind little-endian", () => {
  assert.deepEqual([...int16ToLittleEndian(new Int16Array([1, -2, 0x1234]))], [
    0x01, 0x00, 0xfe, 0xff, 0x34, 0x12,
  ]);
});

test("Pegelanzeige: Stille ist 0, Vollaussteuerung 1", () => {
  assert.equal(meterLevel(new Float32Array(64)), 0);
  assert.equal(meterLevel(new Float32Array(64).fill(1)), 1);
  const mid = meterLevel(new Float32Array(64).fill(0.01));
  assert.ok(mid > 0.3 && mid < 0.4, `−40 dBFS sollte bei 1/3 liegen, war ${mid}`);
});

test("Sitzung: beendet ausdrücklich oder nach Schweigen, sonst offen", () => {
  const startedAt = new Date("2026-09-16T10:00:00Z");
  const now = new Date(startedAt.getTime() + 5_000);
  assert.equal(isLiveSessionOpen({ status: "LIVE", lastChunkAt: null, startedAt }, now), true);
  assert.equal(isLiveSessionOpen({ status: "ENDED", lastChunkAt: null, startedAt }, now), false);

  const late = new Date(startedAt.getTime() + LIVE_STALE_AFTER_MS + 1);
  assert.equal(isLiveSessionOpen({ status: "LIVE", lastChunkAt: null, startedAt }, late), false);
  assert.equal(
    isLiveSessionOpen({ status: "LIVE", lastChunkAt: new Date(late.getTime() - 1_000), startedAt }, late),
    true
  );
});
