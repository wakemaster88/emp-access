import { test } from "node:test";
import assert from "node:assert/strict";
import { serialRuns } from "./heartbeat-rules.js";

/** Ein Lauf, der erst endet, wenn der Test ihn freigibt; `built` haelt fest, welchen Stand er mitnahm. */
function harness() {
  let state = 0;
  const built: number[] = [];
  const release: Array<() => void> = [];
  const send = () => {
    built.push(state);
    return new Promise<void>((r) => release.push(r));
  };
  return { set: (v: number) => (state = v), built, release, run: serialRuns(send) };
}

const tick = () => new Promise((r) => setImmediate(r));

test("Lebenszeichen nacheinander: das zweite baut seinen Inhalt erst nach der Antwort des ersten", async () => {
  const h = harness();
  h.set(1);
  const first = h.run();
  await tick();
  // Waehrend das erste unterwegs ist, aendert sich der Stand (Kamera faellt weg).
  h.set(2);
  const second = h.run();
  await tick();
  assert.deepEqual(h.built, [1]);
  h.release[0]();
  await first;
  await tick();
  assert.deepEqual(h.built, [1, 2]);
  h.release[1]();
  await second;
});

test("Mehrere Anforderungen während eines Laufs ergeben genau einen weiteren Lauf mit dem neuesten Stand", async () => {
  const h = harness();
  h.set(1);
  void h.run();
  await tick();
  h.set(2);
  const a = h.run();
  h.set(3);
  const b = h.run();
  assert.equal(a, b);
  h.release[0]();
  await tick();
  await tick();
  assert.deepEqual(h.built, [1, 3]);
  h.release[1]();
  await a;
  // Danach beginnt ein neuer Lauf sofort.
  h.set(4);
  void h.run();
  await tick();
  assert.deepEqual(h.built, [1, 3, 4]);
  h.release[2]();
});

test("Ein Lauf, der wirft, hält die nächsten nicht auf", async () => {
  let n = 0;
  const run = serialRuns(async () => {
    n++;
    if (n === 1) throw new Error("kaputt");
  });
  await run();
  await run();
  assert.equal(n, 2);
});
