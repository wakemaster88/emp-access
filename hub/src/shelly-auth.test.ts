import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { credentialFingerprint } from "./auth-latch.js";

/*
 * Abgelehntes Shelly-Passwort (shelly.ts, Regeln in auth-latch.ts) gegen
 * einen Shelly als Attrappe (Gen1, Basic-Auth) auf 127.0.0.1. Der Test laedt
 * eine Kopie von hub/src aus einem eigenen Verzeichnis, ohne .env und mit
 * eigenem .cache. Die Uhr (Date) geht nur, wenn der Test sie stellt.
 */

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
const DAY = 24 * 60 * 60_000;
let clock = T0;
mock.timers.enable({ apis: ["Date"], now: T0 });
const advance = (ms: number) => {
  clock += ms;
  mock.timers.setTime(clock);
};

const hubLog: string[] = [];
mock.method(console, "log", (line: unknown) => {
  hubLog.push(String(line).replace(/^\[[^\]]*\] /, ""));
});
const logged = (what: RegExp) => hubLog.filter((line) => what.test(line));

const WRONG = "falsches-kennwort";
const RIGHT = "richtiges-kennwort";

const dummy = {
  server: http.createServer(),
  /** Alle Anfragen, auch /shelly ohne Anmeldung. */
  requests: 0,
  /** Anfragen mit Zugangsdaten. */
  authTries: 0,
};
dummy.server.on("request", (req, res) => {
  res.setHeader("Connection", "close");
  dummy.requests++;
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/shelly") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ type: "SHSW-1", mac: "02005E100004", auth: true }));
    return;
  }
  const auth = req.headers.authorization;
  if (!auth) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="shelly"' }).end();
    return;
  }
  dummy.authTries++;
  if (auth !== `Basic ${Buffer.from(`admin:${RIGHT}`).toString("base64")}`) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="shelly"' }).end();
    return;
  }
  const body = url.pathname.startsWith("/relay/") ? { ison: true } : { relays: [{ ison: false }], meters: [{ power: 0 }], uptime: 5 };
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
});

let shelly: typeof import("./shelly.js");
let store: typeof import("./auth-latch-store.js");
let hubDir = "";
let host = "";

function claimSandbox(): string {
  for (let n = 0; ; n++) {
    const dir = path.join(os.tmpdir(), `emp-hub-shelly-${n}`);
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

before(async () => {
  const sandbox = claimSandbox();
  process.on("exit", () => fs.rmSync(sandbox, { recursive: true, force: true }));
  hubDir = path.join(sandbox, "hub");
  fs.cpSync(path.dirname(fileURLToPath(import.meta.url)), path.join(hubDir, "src"), {
    recursive: true,
    filter: (file) => !file.endsWith(".test.ts"),
  });
  fs.writeFileSync(path.join(hubDir, "package.json"), JSON.stringify({ type: "module" }));
  const dotenv = createRequire(import.meta.url).resolve("dotenv");
  const modules = `${path.sep}node_modules${path.sep}`;
  fs.symlinkSync(dotenv.slice(0, dotenv.lastIndexOf(modules) + modules.length), path.join(hubDir, "node_modules"), "dir");
  await new Promise<void>((r) => dummy.server.listen(0, "127.0.0.1", r));
  host = `127.0.0.1:${(dummy.server.address() as AddressInfo).port}`;
  for (const key of Object.keys(process.env)) if (/^(HUB|FACE)_/.test(key)) delete process.env[key];
  process.env.HUB_API_URL = "http://127.0.0.1:9";
  process.env.HUB_API_TOKEN = "attrappe";
  process.env.HUB_IMPROVE_LOG = "0";
  process.env.HUB_SHELLY_PASSWORD = WRONG;
  shelly = await import(pathToFileURL(path.join(hubDir, "src", "shelly.ts")).href);
  store = await import(pathToFileURL(path.join(hubDir, "src", "auth-latch-store.ts")).href);
});

after(() => {
  mock.timers.reset();
  dummy.server.closeAllConnections();
  dummy.server.unref();
});

test("Shelly: nach zwei Ablehnungen scheitern Abfragen und Schaltbefehle sofort, ohne Anfrage an das Geraet", async () => {
  await assert.rejects(shelly.shellyStatus(host), /^Error: Shelly-Passwort falsch$/);
  await assert.rejects(shelly.shellyStatus(host), /^Error: Shelly-Passwort falsch$/);
  assert.equal(dummy.authTries, 2);
  assert.deepEqual(logged(/^Shelly /), [
    `Shelly ${host}: Passwort zweimal in Folge abgelehnt – keine weiteren Versuche, bis HUB_SHELLY_PASSWORD geändert wird; ein einzelner Versuch alle 24 h`,
  ]);
  const requests = dummy.requests;
  const blocked = new RegExp(`^Error: Shelly-Passwort abgelehnt \\(${host}\\) – kein Versuch, bis HUB_SHELLY_PASSWORD geändert wird$`);
  await assert.rejects(shelly.shellyStatus(host), blocked);
  await assert.rejects(shelly.shellySwitch(host, 0, true), blocked);
  await assert.rejects(shelly.shellyCoverClose(host, 0), blocked);
  await assert.rejects(shelly.shellyEnvironment(host), blocked);
  assert.equal(await shelly.shellyStatusMap(host), null);
  assert.equal(dummy.requests, requests);
  assert.deepEqual(logged(new RegExp(WRONG)), []);
});

test("Shelly: die Sperre uebersteht einen Neustart; die Datei enthaelt kein Passwort und ist nur fuer den Hub-Benutzer lesbar", async () => {
  await store.authLatches.flushed();
  const file = path.join(hubDir, ".cache", "auth-latch.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, "utf8").includes(WRONG), false);
  const restarted = new store.AuthLatchStore(file);
  await restarted.ready();
  assert.equal(restarted.blocked(`shelly:${host}`, credentialFingerprint("admin", WRONG), Date.now()), true);
  assert.equal(restarted.blocked(`shelly:${host}`, credentialFingerprint("admin", RIGHT), Date.now()), false);
});

test("Shelly: ein einzelner Versuch in 24 Stunden; ein neues HUB_SHELLY_PASSWORD loest die Sperre", async () => {
  advance(DAY - 1);
  const requests = dummy.requests;
  await assert.rejects(shelly.shellyStatus(host), /Shelly-Passwort abgelehnt/);
  assert.equal(dummy.requests, requests);
  advance(1);
  await assert.rejects(shelly.shellyStatus(host), /^Error: Shelly-Passwort falsch$/);
  assert.equal(dummy.authTries, 3);
  // Gleich danach wieder gesperrt, ohne neue Zeile.
  await assert.rejects(shelly.shellySwitch(host, 0, true), /Shelly-Passwort abgelehnt/);
  assert.equal(dummy.authTries, 3);
  assert.equal(logged(/Passwort zweimal/).length, 1);

  process.env.HUB_SHELLY_PASSWORD = RIGHT;
  const st = await shelly.shellyStatus(host);
  assert.equal(st.channels.length, 1);
  assert.deepEqual(logged(/Sperre des Passworts aufgehoben/), [
    `Shelly ${host}: Sperre des Passworts aufgehoben (HUB_SHELLY_PASSWORD geändert)`,
  ]);
  assert.deepEqual(await shelly.shellySwitch(host, 0, true), { on: true });
});
