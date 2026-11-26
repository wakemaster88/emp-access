/**
 * Tagessummen der Diagnose überstehen einen Neustart (improve-log.ts): Der
 * Test lädt eine Kopie von hub/src mit eigenem .cache (wie parking.test.ts)
 * und das Modul ein zweites Mal als „neu gestarteter Hub“. Die Regeln stehen
 * in improve-rules.ts und haben dort ihre Tests.
 */
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Der Snapshot-Takt (setInterval) läuft im Test nicht.
mock.timers.enable({ apis: ["setInterval"] });
mock.method(console, "log", () => undefined);

type ImproveLog = typeof import("./improve-log.js");
let sandbox = "";
let moduleUrl = "";

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "emp-hub-improve-"));
  const hubDir = path.join(sandbox, "hub");
  fs.cpSync(path.dirname(fileURLToPath(import.meta.url)), path.join(hubDir, "src"), {
    recursive: true,
    filter: (file) => !file.endsWith(".test.ts"),
  });
  fs.writeFileSync(path.join(hubDir, "package.json"), JSON.stringify({ type: "module" }));
  const dotenv = createRequire(import.meta.url).resolve("dotenv");
  const modules = `${path.sep}node_modules${path.sep}`;
  fs.symlinkSync(dotenv.slice(0, dotenv.lastIndexOf(modules) + modules.length), path.join(hubDir, "node_modules"), "dir");
  for (const key of Object.keys(process.env)) if (/^(HUB|FACE)_/.test(key)) delete process.env[key];
  process.env.HUB_API_URL = "http://127.0.0.1:9";
  process.env.HUB_API_TOKEN = "attrappe";
  moduleUrl = pathToFileURL(path.join(hubDir, "src", "improve-log.ts")).href;
});

after(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** Modul frisch laden (wie nach einem Neustart) und starten; wartet, bis die Tagessummen gelesen sind. */
async function startHub(run: number): Promise<ImproveLog> {
  const mod = (await import(`${moduleUrl}?start=${run}`)) as ImproveLog;
  mod.startImproveLog();
  const started = Date.now();
  // Die Datei ist gelesen, sobald der Snapshot sie schreibt.
  const file = path.join(sandbox, "hub", ".cache", "improve-daily.json");
  const before = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  for (;;) {
    await mod.flushImproveSnapshot("test");
    if (fs.existsSync(file) && fs.statSync(file).mtimeMs !== before) return mod;
    if (Date.now() - started > 5_000) throw new Error("Tagessummen nicht geschrieben");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

test("Tagessummen: Zähler von vor dem Neustart zählen heute weiter, die der Sitzung beginnen bei null", async () => {
  const first = await startHub(1);
  for (let i = 0; i < 3; i++) first.improveCount("noparking", "clear");
  first.improveCount("noparking", "fail");
  await first.flushImproveSnapshot("exit");

  const second = await startHub(2);
  second.improveCount("noparking", "clear");
  const snap = second.improveSnapshot();
  assert.equal(snap.counts["noparking.clear"], 1, "Sitzung beginnt bei null");
  assert.equal(snap.today.counts["noparking.clear"], 4, "Tag zählt über den Neustart");
  assert.equal(snap.today.counts["noparking.fail"], 1);
  assert.equal(snap.today.counts["boot.start"], 2);

  await second.flushImproveSnapshot("exit");
  const md = fs.readFileSync(path.join(sandbox, "hub", ".cache", "improve-latest.md"), "utf8");
  assert.match(md, /## Heute \(\d{4}-\d{2}-\d{2}, auch über Neustarts\)\n(- .*\n)*- noparking\.clear: 4\n/);
});
