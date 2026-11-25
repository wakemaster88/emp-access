import { test } from "node:test";
import assert from "node:assert/strict";
import { SHUTDOWN_MAX_MS, exitHub, isExiting, onShutdown } from "./shutdown.js";

/** Alles Anstehende ablaufen lassen. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// Der Hub-Prozess selbst (exitHub) laesst sich je Prozess nur einmal beenden,
// und jede Test-Datei laeuft in einem eigenen Prozess: Das geordnete Ende
// (Code 0) steht in shutdown.test.ts, das Ende nach einem unerwarteten Fehler
// hier. Am Code des Prozesses unterscheidet das System-Protokoll beide.
test("exitHub nach einem unerwarteten Fehler: ein process.exit mit Code 1, erst nach dem Aufraeumen", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const steps: string[] = [];
  t.mock.method(process, "exit", ((code?: number) => {
    steps.push(`process.exit(${code})`);
  }) as typeof process.exit);
  onShutdown("diagnose", async () => {
    await settle();
    steps.push("diagnose geschrieben");
  });

  assert.equal(isExiting(), false);
  exitHub(1);
  assert.equal(isExiting(), true);
  assert.deepEqual(steps, []);
  await settle();
  await settle();
  assert.deepEqual(steps, ["diagnose geschrieben", "process.exit(1)"]);
  // Frist und Sicherheitsnetz beenden kein zweites Mal.
  t.mock.timers.tick(SHUTDOWN_MAX_MS + 1_000);
  await settle();
  assert.deepEqual(steps, ["diagnose geschrieben", "process.exit(1)"]);
});
