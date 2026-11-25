import { test } from "node:test";
import assert from "node:assert/strict";
import { PUSH_BLOCK, PUSH_BLOCK_WORST_MS, chunk, pushFitsBudget, worstPushMs } from "./push-blocks";

test("chunk teilt in Blöcke zu 25 und verliert niemanden", () => {
  const items = Array.from({ length: 61 }, (_, i) => i);
  const blocks = chunk(items);
  assert.deepEqual(blocks.map((b) => b.length), [25, 25, 11]);
  assert.deepEqual(blocks.flat(), items);
  assert.deepEqual(chunk([]), []);
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
});

test("worstPushMs rechnet je angefangenem Block", () => {
  assert.equal(worstPushMs(0), 0);
  assert.equal(worstPushMs(1), PUSH_BLOCK_WORST_MS);
  assert.equal(worstPushMs(PUSH_BLOCK), PUSH_BLOCK_WORST_MS);
  assert.equal(worstPushMs(PUSH_BLOCK + 1), 2 * PUSH_BLOCK_WORST_MS);
});

test("pushFitsBudget: startet nur, was in die Restzeit passt", () => {
  const now = 1_000_000;
  // 100 Kunden = 4 Blöcke = 22 s
  assert.equal(pushFitsBudget(100, now, now + 45_000), true);
  assert.equal(pushFitsBudget(100, now, now + 20_000), false);
  // Ohne Empfänger immer (wird wie bisher mit 0 als gesendet markiert).
  assert.equal(pushFitsBudget(0, now, now), true);
  // Passt nie in einen Cron-Lauf (90 s): der Cron startet sie trotzdem, die Route nicht.
  assert.equal(pushFitsBudget(1000, now, now + 90_000, { budgetMs: 90_000 }), true);
  assert.equal(pushFitsBudget(1000, now, now + 45_000), false);
  // Passt in einen frischen Cron-Lauf, aber nicht mehr in diesen: wartet.
  assert.equal(pushFitsBudget(300, now, now + 10_000, { budgetMs: 90_000 }), false);
});
