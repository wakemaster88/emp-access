import { test } from "node:test";
import assert from "node:assert/strict";
import { SHUTDOWN_MAX_MS, Shutdown, exitHub, isExiting, onShutdown, runCleanups } from "./shutdown.js";

test("Aufraeumen: alle laufen nebeneinander, auch wenn einer scheitert", async () => {
  const done: string[] = [];
  const list = new Map<string, () => Promise<unknown> | unknown>([
    ["licht", async () => void done.push("licht")],
    ["kaputt", () => Promise.reject(new Error("Kamera antwortet nicht"))],
    ["wirft-sofort", () => { throw new Error("x"); }],
    ["diagnose", () => void done.push("diagnose")],
  ]);
  const open = await runCleanups(1_000, list);
  assert.deepEqual(done.sort(), ["diagnose", "licht"]);
  assert.deepEqual(open.sort(), ["kaputt", "wirft-sofort"]);
});

test("Aufraeumen: ein haengender Schritt haelt das Beenden nicht ueber die Frist auf", async () => {
  let hangTimer: ReturnType<typeof setTimeout> | undefined;
  const done: string[] = [];
  const list = new Map<string, () => Promise<unknown> | unknown>([
    ["haengt", () => new Promise((resolve) => { hangTimer = setTimeout(resolve, 60_000); })],
    ["diagnose", async () => void done.push("diagnose")],
  ]);
  const started = Date.now();
  const open = await runCleanups(50, list);
  clearTimeout(hangTimer);
  assert.ok(Date.now() - started < 1_000);
  assert.deepEqual(open, ["haengt"]);
  assert.deepEqual(done, ["diagnose"]);
});

test("Aufraeumen: ohne angemeldete Schritte sofort fertig", async () => {
  assert.deepEqual(await runCleanups(1_000, new Map()), []);
});

/** Alles Anstehende ablaufen lassen. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Beenden mit einer Attrappe statt process.exit: haelt fest, womit der
 * Prozess geendet haette (`exits`) und in welcher Reihenfolge (`steps`, dort
 * tragen die Tests auch ihre Aufraeumer ein).
 */
function fakeHub(maxMs = 1_000) {
  const exits: number[] = [];
  const logged: string[] = [];
  const steps: string[] = [];
  let ended: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    ended = resolve;
  });
  const hub = new Shutdown({
    exit: (code) => {
      exits.push(code);
      steps.push(`ende ${code}`);
      ended();
    },
    log: (msg) => logged.push(msg),
    maxMs,
  });
  return { hub, exits, logged, steps, done };
}

test("Unerwarteter Fehler: der Hub gilt sofort als beendend und endet mit Code 1", async () => {
  const { hub, exits, done } = fakeHub();
  assert.equal(hub.isExiting(), false);
  hub.exit(1);
  // Noch im selben Augenblick, nicht erst nach dem Aufraeumen.
  assert.equal(hub.isExiting(), true);
  assert.deepEqual(exits, []);
  await done;
  assert.deepEqual(exits, [1]);
});

test("Fehler waehrend eines geordneten Beendens: ein Ende, und zwar mit Code 1", async () => {
  const { hub, exits, done } = fakeHub();
  let release: () => void = () => undefined;
  hub.onShutdown("langsam", () => new Promise<void>((resolve) => (release = resolve)));
  hub.exit(0);
  hub.exit(1);
  release();
  await done;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [1]);
});

test("Beenden: was nicht fertig wurde, steht mit Namen im Log", async () => {
  const { hub, exits, logged, done } = fakeHub(50);
  let hangTimer: ReturnType<typeof setTimeout> | undefined;
  hub.onShutdown("weisslicht:3", () => new Promise((resolve) => { hangTimer = setTimeout(resolve, 60_000); }));
  hub.onShutdown("weisslicht:7", () => Promise.reject(new Error("Kamera antwortet nicht")));
  hub.onShutdown("diagnose", async () => undefined);
  hub.exit(0);
  await done;
  clearTimeout(hangTimer);
  assert.deepEqual(logged, ["Aufräumen unvollständig: weisslicht:3, weisslicht:7"]);
  assert.deepEqual(exits, [0]);
});

test("Beenden: ist alles aufgeraeumt, steht dazu nichts im Log", async () => {
  const { hub, exits, logged, done } = fakeHub();
  hub.onShutdown("weisslicht:3", async () => undefined);
  hub.onShutdown("diagnose", () => undefined);
  hub.exit(0);
  await done;
  assert.deepEqual(logged, []);
  assert.deepEqual(exits, [0]);
});

test("Beenden: wer sich erst waehrend des Aufraeumens anmeldet, laeuft sofort, und das Ende wartet auf ihn", async () => {
  const { hub, exits, logged, done } = fakeHub();
  const ran: string[] = [];
  let release: () => void = () => undefined;
  let releaseLate: () => void = () => undefined;
  hub.onShutdown("langsam", () => new Promise<void>((resolve) => (release = resolve)));
  hub.exit(0);
  // Ein Licht geht an, waehrend der Hub schon aufraeumt: Sein Aufraeumer
  // kaeme sonst nie an die Reihe.
  hub.onShutdown("weisslicht:3", () => {
    ran.push("weisslicht:3");
    return new Promise<void>((resolve) => (releaseLate = resolve));
  });
  assert.deepEqual(ran, ["weisslicht:3"]);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, []);
  releaseLate();
  await done;
  assert.deepEqual(exits, [0]);
  assert.deepEqual(logged, []);
});

test("Beenden: scheitert ein spaet Angemeldeter, steht auch er im Log", async () => {
  const { hub, logged, done } = fakeHub();
  let release: () => void = () => undefined;
  hub.onShutdown("langsam", () => new Promise<void>((resolve) => (release = resolve)));
  hub.exit(0);
  hub.onShutdown("weisslicht:7", () => Promise.reject(new Error("Kamera antwortet nicht")));
  release();
  await done;
  assert.deepEqual(logged, ["Aufräumen unvollständig: weisslicht:7"]);
});

test("Beenden: meldet ein Aufraeumer dabei einen weiteren an, laeuft der genau einmal", async () => {
  const { hub, exits, logged, done } = fakeHub();
  const ran: string[] = [];
  hub.onShutdown("erster", () => {
    ran.push("erster");
    hub.onShutdown("nachgemeldet", () => void ran.push("nachgemeldet"));
  });
  hub.exit(0);
  await done;
  assert.deepEqual(ran, ["erster", "nachgemeldet"]);
  assert.deepEqual(logged, []);
  assert.deepEqual(exits, [0]);
});

test("Beenden: meldet sich einer an, gerade als der letzte fertig wird, wartet das Ende auch auf ihn", async () => {
  const { hub, logged, steps, done } = fakeHub();
  let finishFirst: () => void = () => undefined;
  const first = new Promise<void>((resolve) => (finishFirst = resolve));
  hub.onShutdown("erster", () => first);
  hub.exit(0);
  // Im selben Augenblick, in dem der erste fertig ist, meldet sich der naechste an.
  void first.then(() =>
    hub.onShutdown("naechster", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      steps.push("naechster fertig");
    })
  );
  finishFirst();
  await done;
  assert.deepEqual(steps, ["naechster fertig", "ende 0"]);
  assert.deepEqual(logged, []);
});

test("Beenden: zwei Aufrufe zaehlen einmal – ein Aufraeumen, ein Ende", async () => {
  const { hub, exits, done } = fakeHub();
  let runs = 0;
  hub.onShutdown("diagnose", async () => void runs++);
  hub.exit(0);
  hub.exit(0);
  await done;
  await settle();
  // Auch ein Aufruf nach dem Ende (der Prozess laeuft in der Attrappe weiter) zaehlt nicht neu.
  hub.exit(0);
  await settle();
  assert.equal(runs, 1);
  assert.deepEqual(exits, [0]);
});

test("Beenden: der Prozess endet erst, wenn der Aufraeumer fertig ist", async () => {
  const { hub, steps, done } = fakeHub();
  hub.onShutdown("weisslicht:3", async () => {
    steps.push("licht aus: Befehl");
    await new Promise((resolve) => setTimeout(resolve, 20));
    steps.push("licht aus: fertig");
  });
  hub.exit(0);
  // Der Aufraeumer laeuft sofort los, das Ende wartet.
  assert.deepEqual(steps, ["licht aus: Befehl"]);
  await done;
  assert.deepEqual(steps, ["licht aus: Befehl", "licht aus: fertig", "ende 0"]);
});

test("Beenden: wer sich abmeldet, nimmt nur den eigenen Aufraeumer mit", async () => {
  const { hub, steps, done } = fakeHub();
  // Das Licht an Kamera 3 geht aus und fuer den naechsten Burst wieder an:
  // Das spaete Abmelden des ersten darf den zweiten nicht mitnehmen.
  const forgetFirst = hub.onShutdown("weisslicht:3", () => void steps.push("erstes Licht"));
  hub.onShutdown("weisslicht:3", () => void steps.push("zweites Licht"));
  forgetFirst();
  const forgetOther = hub.onShutdown("weisslicht:7", () => void steps.push("anderes Licht"));
  forgetOther();
  hub.exit(0);
  await done;
  assert.deepEqual(steps, ["zweites Licht", "ende 0"]);
});

test("Beenden: ein haengender Aufraeumer haelt den Hub 3 s auf, nicht laenger", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { hub, exits, logged } = fakeHub(SHUTDOWN_MAX_MS);
  hub.onShutdown("weisslicht:3", () => new Promise(() => undefined));
  hub.exit(0);
  t.mock.timers.tick(2_999);
  await settle();
  assert.deepEqual(exits, []);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(exits, [0]);
  assert.deepEqual(logged, ["Aufräumen unvollständig: weisslicht:3"]);
});

// Der Hub-Prozess selbst (exitHub) laesst sich je Prozess nur einmal beenden:
// ein Test, als letzter der Datei.
test("exitHub: zwei Aufrufe, ein process.exit – vorher lief der Aufraeumer, und was offen blieb, steht im Log", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const steps: string[] = [];
  t.mock.method(process, "exit", ((code?: number) => {
    steps.push(`process.exit(${code})`);
  }) as typeof process.exit);
  t.mock.method(console, "log", (line: unknown) => {
    steps.push(`log: ${String(line).replace(/^\[[^\]]+\] /, "")}`);
  });
  onShutdown("diagnose", async () => {
    await settle();
    steps.push("diagnose geschrieben");
  });
  onShutdown("weisslicht:3", () => new Promise(() => undefined));

  assert.equal(isExiting(), false);
  exitHub(0);
  assert.equal(isExiting(), true);
  exitHub(0);
  await settle();
  await settle();
  // Der schnelle Aufraeumer ist durch, der haengende haelt das Ende bis zur Frist auf.
  assert.deepEqual(steps, ["diagnose geschrieben"]);
  t.mock.timers.tick(SHUTDOWN_MAX_MS);
  await settle();
  assert.deepEqual(steps, ["diagnose geschrieben", "log: Aufräumen unvollständig: weisslicht:3", "process.exit(0)"]);
  // Das Sicherheitsnetz (eine Sekunde spaeter) beendet kein zweites Mal.
  t.mock.timers.tick(1_000);
  await settle();
  assert.equal(steps.filter((s) => s.startsWith("process.exit")).length, 1);
});
