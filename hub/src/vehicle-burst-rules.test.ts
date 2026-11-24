import { test } from "node:test";
import assert from "node:assert/strict";
import { burstConsensus, burstDone, pickFallbackFrame, type FrameRead } from "./vehicle-burst-rules.js";
import { KNOWN_CITY } from "./plate-match.js";

const OPTS = { minConf: 0.8, knownCity: KNOWN_CITY };

/** Bild i mit einer Lesung (oder keiner). */
function burst(rows: Array<[string, number] | null>): FrameRead[] {
  return rows.map((r, index) => ({ index, candidates: r ? [{ plate: r[0], confidence: r[1] }] : [] }));
}

test("Kennzeichen aus der Region wird über den Burst erkannt (Befund 19.11.)", () => {
  const reads = burst([
    null, null, null, null, null, null, null, null,
    ["GT-AB 4321", 0.98], null, ["GT-AB 4321", 0.98], null, null,
    ["Y-AB 1234", 0.53], ["GT-AB 4321", 0.98], ["GT-AB 4321", 0.97], ["GT-AB 4321", 0.98],
    ["GT-AB 4321", 0.98], ["GT-AB 432", 0.97], ["GT-AB 4321", 0.98],
  ]);
  const c = burstConsensus(reads, OPTS);
  assert.ok(c);
  assert.equal(c.plate, "GT-AB 4321");
  assert.equal(c.frames, 8); // 7 volle + 1 abgeschnittene Lesung
  // Mittleres der sicheren Bilder, nicht das letzte.
  assert.ok(c.bestIndex > 8 && c.bestIndex < 19, `bestIndex ${c.bestIndex}`);
});

test("Mehrheit schlägt Einzel-Fehllesung (ST-K einmal, GT-K viermal)", () => {
  const reads = burst([
    ["ST-K 3434E", 0.91],
    ["GT-K 3434E", 0.95],
    ["GT-K 3434E", 0.96],
    ["GT-K 3434E", 0.97],
    ["B-TK 3434E", 0.92],
    ["GT-K 3434E", 0.95],
  ]);
  assert.equal(burstConsensus(reads, OPTS)?.plate, "GT-K 3434E");
});

test("zweistelliges Kennzeichen braucht drei Bilder (BE-AB 34)", () => {
  assert.equal(burstConsensus(burst([["BE-AB 34", 0.97], ["BE-AB 34", 0.97]]), OPTS), null);
  assert.equal(
    burstConsensus(burst([["BE-AB 34", 0.97], ["BE-AB 34", 0.97], ["BE-AB 34", 0.97]]), OPTS)?.plate,
    "BE-AB 34"
  );
});

test("einzelnes Bild: nur mit sehr hoher Confidence", () => {
  assert.equal(burstConsensus(burst([["PB-AB 2345", 0.9]]), OPTS), null);
  assert.equal(burstConsensus(burst([["PB-AB 2345", 0.97]]), OPTS)?.plate, "PB-AB 2345");
});

test("unsichere oder unbekannte Lesungen zählen nicht", () => {
  const reads = burst([["K-AB 123", 0.54], ["XQ-AB 123", 0.97], ["XQ-AB 123", 0.97], ["GR-AB 123", 0.56]]);
  assert.equal(burstConsensus(reads, OPTS), null);
});

test("Fallback-Bild: Schild sichtbar vor größter Box, nie einfach das letzte", () => {
  const reads = burst([null, ["SO-XZ 575E", 0.76], null, null]);
  assert.deepEqual(pickFallbackFrame(reads, [0.05, 0.04, 0.03, 0.02], 0), { index: 1, why: "ocr" });
  assert.deepEqual(pickFallbackFrame(burst([null, null, null]), [0.02, 0.09, 0.03], 0), { index: 1, why: "area" });
  assert.equal(pickFallbackFrame(burst([null, null]), [0, null], 0), null);
});

test("Burst endet nach bestätigtem Kennzeichen plus Nachlauf", () => {
  const rows: Array<[string, number] | null> = [null, ["PB-AB 2345", 0.97], ["PB-AB 2345", 0.96], ["PB-AB 2345", 0.97]];
  const reads = burst(rows);
  assert.equal(burstDone(reads, 4, { ...OPTS, afterFrames: 2 }), false);
  assert.equal(burstDone(reads, 5, { ...OPTS, afterFrames: 2 }), false);
  assert.equal(burstDone(reads, 6, { ...OPTS, afterFrames: 2 }), true);
  // Ohne bestätigtes Kennzeichen läuft der Burst weiter.
  assert.equal(burstDone(burst([["PB-AB 2345", 0.97], null, null, null]), 12, OPTS), false);
});
