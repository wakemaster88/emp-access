import { test } from "node:test";
import assert from "node:assert/strict";
import { CheckLoop, type CheckLoopDeps } from "./check-loop.js";
import { runExclusive, type RunSlot } from "./noparking-rules.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Uhr und Timer zum Vorspulen. */
class FakeClock {
  now = 0;
  private seq = 0;
  readonly timers = new Map<number, { at: number; fn: () => void }>();
  set = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };
  clear = (h: unknown): void => {
    this.timers.delete(h as number);
  };
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
      for (let i = 0; i < 5; i++) await flush();
    }
    this.now = end;
  }
}

function loopWith(clock: FakeClock, o: Partial<CheckLoopDeps> & Pick<CheckLoopDeps, "run">) {
  const errors: unknown[] = [];
  const loop = new CheckLoop({
    delayMs: () => 20_000,
    firstDelayMs: 20_000,
    fallbackMs: 20_000,
    minGapMs: 1_000,
    onError: (e) => errors.push(e),
    now: () => clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
    ...o,
  });
  return { loop, errors };
}

test("CheckLoop: genau ein Timer, Abstand nach der Regel ab Beginn des Durchlaufs", async () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  let delay = 60_000;
  const { loop } = loopWith(clock, {
    run: async () => {
      starts.push(clock.now);
      clock.now += 2_000; // Schnappschuss und Erkennung
    },
    delayMs: () => delay,
  });
  assert.equal(loop.start(), true);
  assert.equal(loop.start(), false);
  assert.equal(clock.timers.size, 1);
  await clock.advance(20_000 + 60_000 * 2);
  assert.deepEqual(starts, [20_000, 80_000, 140_000]);
  delay = 20_000;
  await clock.advance(60_000 + 40_000);
  assert.deepEqual(starts.slice(3), [200_000, 220_000, 240_000]);
  assert.equal(clock.timers.size, 1);
  loop.stop();
});

test("CheckLoop: Fehler im Durchlauf und in der Wartezeit reißen die Kette nicht ab", async () => {
  const clock = new FakeClock();
  let n = 0;
  const { loop, errors } = loopWith(clock, {
    run: async () => {
      n++;
      if (n === 1) throw new Error("Kamera weg");
      if (n === 2) return Promise.reject(new Error("Tracker weg"));
    },
    delayMs: () => {
      if (n === 3) throw new Error("Regel kaputt");
      return n === 4 ? Number.NaN : 20_000;
    },
    fallbackMs: 30_000,
  });
  loop.start();
  await clock.advance(20_000 + 20_000 + 20_000 + 30_000 + 30_000 + 20_000);
  assert.equal(n, 6);
  assert.deepEqual(
    errors.map((e) => (e as Error).message),
    ["Kamera weg", "Tracker weg", "Regel kaputt"],
  );
  assert.equal(clock.timers.size, 1);
  loop.stop();
});

test("CheckLoop: auch ein synchron werfender Durchlauf und ein werfender Fehler-Melder halten den Takt", async () => {
  const clock = new FakeClock();
  let n = 0;
  const loop = new CheckLoop({
    run: () => {
      n++;
      throw new Error("sofort");
    },
    delayMs: () => 20_000,
    firstDelayMs: 1_000,
    fallbackMs: 20_000,
    minGapMs: 1_000,
    onError: () => {
      throw new Error("Log weg");
    },
    now: () => clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
  });
  loop.start();
  await clock.advance(1_000 + 20_000 * 3);
  assert.equal(n, 4);
  loop.stop();
});

test("CheckLoop: Durchlauf länger als der Takt – der nächste folgt nach dem Mindestabstand", async () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  const { loop } = loopWith(clock, {
    run: async () => {
      starts.push(clock.now);
      if (starts.length === 1) clock.now += 35_000; // Ansage abgewartet
    },
  });
  loop.start();
  await clock.advance(20_000 + 36_000 + 20_000);
  assert.deepEqual(starts, [20_000, 56_000, 76_000]);
  loop.stop();
});

test("CheckLoop: stop beendet den Takt, auch während eines Durchlaufs", async () => {
  const clock = new FakeClock();
  let n = 0;
  let finish: () => void = () => {};
  const { loop } = loopWith(clock, {
    run: () => {
      n++;
      return new Promise<void>((resolve) => (finish = resolve));
    },
  });
  loop.start();
  await clock.advance(20_000);
  assert.equal(n, 1);
  loop.stop();
  finish();
  await clock.advance(5 * 60_000);
  assert.equal(n, 1);
  assert.equal(clock.timers.size, 0);
  assert.equal(loop.start(), false);
});

test("CheckLoop: soon holt den nächsten Durchlauf vor, nie nach hinten, nicht während eines Durchlaufs", async () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  let finish: (() => void) | null = null;
  let hold = false;
  const { loop } = loopWith(clock, {
    run: () => {
      starts.push(clock.now);
      if (!hold) return Promise.resolve();
      return new Promise<void>((resolve) => (finish = resolve));
    },
    delayMs: () => 60_000,
  });
  loop.soon(1_000); // vor start: ohne Wirkung
  assert.equal(clock.timers.size, 0);
  loop.start();
  await clock.advance(20_000); // erster Durchlauf, nächster bei 80 s
  assert.equal(loop.dueAt, 80_000);
  clock.now = 30_000;
  loop.soon(20_000);
  assert.equal(loop.dueAt, 50_000);
  loop.soon(40_000); // später als geplant: bleibt bei 50 s
  assert.equal(loop.dueAt, 50_000);
  assert.equal(clock.timers.size, 1);
  hold = true;
  await clock.advance(20_000);
  assert.deepEqual(starts, [20_000, 50_000]);
  loop.soon(1_000); // während des Durchlaufs: ohne Wirkung
  assert.equal(clock.timers.size, 0);
  (finish as (() => void) | null)?.();
  await flush();
  await flush();
  assert.equal(loop.dueAt, 110_000);
  loop.stop();
});

test("CheckLoop mit runExclusive: ein hängender Durchlauf wird freigegeben, der Takt geht weiter", async () => {
  const slot: RunSlot = { current: null };
  const results: string[] = [];
  let calls = 0;
  const loop = new CheckLoop({
    run: async () => {
      calls++;
      const r = await runExclusive(
        slot,
        Date.now(),
        30,
        async (run) => {
          // Erster Durchlauf hängt für immer.
          if (calls === 1) await new Promise(() => {});
          if (run.abandoned) return;
        },
        () => {},
        () => {},
      );
      results.push(r);
    },
    delayMs: () => 5,
    firstDelayMs: 0,
    fallbackMs: 5,
    minGapMs: 1,
  });
  loop.start();
  await new Promise((r) => setTimeout(r, 200));
  loop.stop();
  assert.equal(results[0], "stuck");
  assert.ok(results.length >= 3, `${results.length} Durchläufe`);
  assert.ok(results.slice(1).every((r) => r === "done"));
});

test("CheckLoop: Uhr springt während eines Durchlaufs zurück oder vor – der Abstand bleibt im Rahmen", async () => {
  const clock = new FakeClock();
  // Wanduhr des Macs (für die Rechnung) gegen den Timer (läuft gleichmäßig).
  let offset = 0;
  const starts: number[] = [];
  const { loop } = loopWith(clock, {
    now: () => clock.now + offset,
    run: async () => {
      starts.push(clock.now);
      clock.now += 2_000;
      // Zweiter Durchlauf: Zeitabgleich stellt die Uhr eine Stunde zurück; dritter: eine Stunde vor.
      if (starts.length === 2) offset -= 3_600_000;
      if (starts.length === 3) offset += 3_600_000;
    },
    delayMs: () => 20_000,
  });
  loop.start();
  await clock.advance(100_000);
  // Zurück: höchstens der geplante Abstand ab Ende des Durchlauf (62 s statt 61 min).
  // Vor: der nächste nach dem Mindestabstand (65 s), danach wieder im Takt.
  assert.deepEqual(starts, [20_000, 40_000, 62_000, 65_000, 85_000]);
  assert.equal(clock.timers.size, 1);
  loop.stop();
});
