import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import { createRequire, syncBuiltinESMExports } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * Lokale Kopie der Kamera-Liste (hub/.cache/cameras.json) in cameras.ts gegen
 * Attrappen: eine Cloud, zwei Kameras und eine DoorBird auf 127.0.0.1. Die
 * Regeln (Alter, Aufbau, was aus der Kopie nicht gilt) stehen in
 * camera-cache-rules.ts und haben dort ihre Tests; hier steht, dass der Hub
 * sie beim Start ohne Cloud anwendet und die Kopie danach ersetzt.
 *
 * Der Test laedt eine Kopie von hub/src aus einem eigenen Verzeichnis, ohne
 * .env und mit eigenem .cache, in dem vor dem Start schon eine Kopie der
 * Kamera-Liste liegt. Die Uhr (Date) steht und geht nur, wenn der Test sie
 * stellt. Die Tests laufen in dieser Reihenfolge und teilen sich den Hub.
 */

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
let clock = T0;
mock.timers.enable({ apis: ["Date"], now: T0 });
const advance = (ms: number) => {
  clock += ms;
  mock.timers.setTime(clock);
};

/* ------------------------------------------ nichts verlaesst den Test */

const noProgram = () => {
  throw new Error("im Test gesperrt");
};
const failProgram = (...args: unknown[]) => {
  const done = args.find((a) => typeof a === "function") as ((err: Error) => void) | undefined;
  setImmediate(() => done?.(new Error("im Test gesperrt")));
};
Object.assign(childProcess, {
  exec: failProgram,
  execFile: failProgram,
  execSync: noProgram,
  execFileSync: noProgram,
  spawn: noProgram,
  spawnSync: noProgram,
  fork: noProgram,
});
/** Dateien, die der Hub ersetzt hat: Er schreibt in eine Zwischendatei und benennt sie um. */
const replaced: string[] = [];
const rename = fsp.rename;
Object.assign(fsp, {
  rename: (from: fs.PathLike, to: fs.PathLike) => {
    replaced.push(path.basename(String(to)));
    return rename(from, to);
  },
});
syncBuiltinESMExports();

const dummies = new Set<string>();
const foreign: string[] = [];
let pending = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!dummies.has(url.origin)) {
    foreign.push(url.origin + url.pathname);
    throw new Error("im Test gesperrt");
  }
  // Die Dauerverbindung der DoorBird zaehlt nicht: Sie bleibt offen.
  if (url.pathname.endsWith("/monitor.cgi")) return realFetch(input, init);
  pending++;
  try {
    const res = await realFetch(input, init);
    const body = await res.arrayBuffer();
    return new Response(res.status === 204 ? null : body, { status: res.status, headers: res.headers });
  } finally {
    pending--;
  }
}) as typeof fetch;

const hubLog: string[] = [];
mock.method(console, "log", (line: unknown) => {
  hubLog.push(String(line).replace(/^\[[^\]]*\] /, ""));
});
const logged = (what: RegExp) => hubLog.filter((line) => what.test(line));

/* ---------------------------------------------------------- Attrappen */

/** Passwort in der Kopie und in der Antwort der Cloud: Es darf in keiner Log-Zeile stehen. */
const SECRET = "attrappe-kennwort";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

interface CameraDummy {
  server: http.Server;
  polls: number;
}

function cameraDummy(): CameraDummy {
  const cam: CameraDummy = { server: http.createServer(), polls: 0 };
  cam.server.on("request", (req, res) => {
    res.setHeader("Connection", "close");
    if (new URL(req.url ?? "/", "http://x").searchParams.get("cmd") === "Snap") {
      res.writeHead(200, { "Content-Type": "image/jpeg" }).end(JPEG);
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let cmds: string[] = [];
      try {
        cmds = (JSON.parse(body) as Array<{ cmd: string }>).map((c) => c.cmd);
      } catch {
        // keine Liste: leere Antwort
      }
      if (cmds.includes("GetMdState")) cam.polls++;
      const value = (cmd: string) =>
        cmd === "Login" ? { Token: { name: "attrappe", leaseTime: 3600 } } : cmd === "GetMdState" ? { state: 0 } : {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(cmds.map((cmd) => ({ cmd, code: 0, value: value(cmd) }))));
    });
  });
  return cam;
}

const camA = cameraDummy();
const camOld = cameraDummy();

const door = {
  server: http.createServer(),
  opens: 0,
  monitorRequests: 0,
  open: new Set<http.ServerResponse>(),
};
door.server.on("request", (req, res) => {
  res.setHeader("Connection", "close");
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/bha-api/open-door.cgi") {
    door.opens++;
    return void res.writeHead(200).end();
  }
  if (url.pathname !== "/bha-api/monitor.cgi") return void res.writeHead(404).end();
  door.monitorRequests++;
  // Dauerverbindung ohne Ereignis.
  door.open.add(res);
  res.on("close", () => door.open.delete(res));
});

const cloud = {
  server: http.createServer(),
  /** Status der Kamera-Liste; 200 = cloud.list. */
  listStatus: 503,
  list: [] as Array<Record<string, unknown>>,
  listRequests: 0,
};
cloud.server.on("request", (req, res) => {
  res.setHeader("Connection", "close");
  req.resume();
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/api/hub/cameras") {
      cloud.listRequests++;
      if (cloud.listStatus !== 200) return void res.writeHead(cloud.listStatus).end();
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(cloud.list));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
});

/* ----------------------------------------------------------- der Hub */

const port = (server: http.Server) => (server.address() as AddressInfo).port;
const iso = (ms: number) => new Date(ms).toISOString();

const reolink = (id: number, name: string, cam: CameraDummy, over: Record<string, unknown> = {}) => ({
  id,
  name,
  kind: "REOLINK",
  host: "127.0.0.1",
  macAddress: null,
  httpPort: port(cam.server),
  https: false,
  username: "attrappe",
  password: SECRET,
  channel: 0,
  vehicleDetection: false,
  deliveryMode: null,
  ...over,
});
const doorbird = (over: Record<string, unknown> = {}) => ({
  id: 11,
  name: "Tor",
  kind: "DOORBIRD",
  host: "127.0.0.1",
  macAddress: null,
  httpPort: port(door.server),
  https: false,
  username: "attrappe",
  password: SECRET,
  channel: 0,
  ...over,
});

let hub: typeof import("./cameras.js");
let doorbirdHub: typeof import("./doorbird.js");
let cacheFile = "";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(what: string, done: () => boolean): Promise<void> {
  const started = performance.now();
  while (!done()) {
    if (performance.now() - started > 20_000) throw new Error(`gewartet auf: ${what}`);
    await turn();
  }
}
async function quiet(): Promise<void> {
  let calm = 0;
  await until(`${pending} offene Anfragen`, () => {
    calm = pending === 0 ? calm + 1 : 0;
    return calm > 10;
  });
}
/** Ein Takt: Uhr vorstellen, abfragen, warten, bis nichts mehr unterwegs ist. */
async function tick(ms: number): Promise<void> {
  advance(ms);
  await hub.pollCameras();
  await quiet();
}
const modeOf = (file: string) => fs.statSync(file).mode & 0o777;
/** Zeitstempel der Kopie auf der Platte (die Umbenennung kann noch unterwegs sein). */
const savedAtOnDisk = () => {
  try {
    return (JSON.parse(fs.readFileSync(cacheFile, "utf8")) as { savedAt?: string }).savedAt ?? null;
  } catch {
    return null;
  }
};
const holdOf = () => doorbirdHub.listDoorbirdStatus().find((d) => d.id === 11)?.hold ?? null;

function claimSandbox(): string {
  for (let n = 0; ; n++) {
    const dir = path.join(os.tmpdir(), `emp-hub-kopie-${n}`);
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

/** Kopie von hub/src mit eigenem .cache; `cache` = Inhalt von cameras.json vor dem Start. */
function hubSandbox(cache: string): string {
  const sandbox = claimSandbox();
  process.on("exit", () => fs.rmSync(sandbox, { recursive: true, force: true }));
  const hubDir = path.join(sandbox, "hub");
  fs.cpSync(path.dirname(fileURLToPath(import.meta.url)), path.join(hubDir, "src"), {
    recursive: true,
    filter: (file) => !file.endsWith(".test.ts"),
  });
  fs.writeFileSync(path.join(hubDir, "package.json"), JSON.stringify({ type: "module" }));
  const dotenv = createRequire(import.meta.url).resolve("dotenv");
  const modules = `${path.sep}node_modules${path.sep}`;
  fs.symlinkSync(dotenv.slice(0, dotenv.lastIndexOf(modules) + modules.length), path.join(hubDir, "node_modules"), "dir");
  fs.mkdirSync(path.join(hubDir, ".cache"));
  fs.writeFileSync(path.join(hubDir, ".cache", "cameras.json"), cache, { mode: 0o600 });
  return hubDir;
}

const servers = [cloud.server, camA.server, camOld.server, door.server];

before(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.listen(0, "127.0.0.1", r))));
  for (const s of servers) dummies.add(`http://127.0.0.1:${port(s)}`);
  for (const key of Object.keys(process.env)) if (/^(HUB|FACE)_/.test(key)) delete process.env[key];
  process.env.HUB_API_URL = `http://127.0.0.1:${port(cloud.server)}`;
  process.env.HUB_API_TOKEN = "attrappe";
  process.env.HUB_IMPROVE_LOG = "0";

  // Die Kopie vom vorletzten Tag: Kamera A (Lieferdienst „Tor öffnen“), eine
  // Kamera, die es in der Cloud inzwischen nicht mehr gibt, und die DoorBird
  // mit einem Offenhalten, das noch zwei Stunden liefe. Der Hub schreibt das
  // Offenhalten nie in die Kopie; hier steht es trotzdem darin.
  const hubDir = hubSandbox(
    JSON.stringify({
      version: 1,
      savedAt: iso(T0 - 2 * DAY),
      cameras: [
        reolink(1, "A", camA, { deliveryMode: "OPEN" }),
        reolink(5, "Alt", camOld),
        doorbird({ doorHoldUntil: iso(T0 + 2 * 60 * MIN) }),
      ],
    })
  );
  cacheFile = path.join(hubDir, ".cache", "cameras.json");
  hub = await import(pathToFileURL(path.join(hubDir, "src", "cameras.ts")).href);
  doorbirdHub = await import(pathToFileURL(path.join(hubDir, "src", "doorbird.ts")).href);
});

after(async () => {
  doorbirdHub.syncDoorbirds([]);
  for (const res of door.open) res.destroy();
  await quiet();
  mock.timers.reset();
  for (const s of servers) {
    s.closeAllConnections();
    s.unref();
  }
  assert.deepEqual(foreign, [], "der Hub spricht im Test nur mit den Attrappen");
});

test("Start ohne Cloud: Der Hub fragt die Kameras aus der lokalen Kopie ab, mit einer Log-Zeile und ohne zu schalten", async () => {
  await hub.pollCameras();
  await quiet();
  assert.equal(cloud.listRequests, 1);
  assert.deepEqual(logged(/lokale[rn]? Kopie/), [
    "Kamera-Liste aus lokaler Kopie vom 24.11.2026, 10:00 (3 Kameras) – bis die Cloud antwortet",
  ]);
  assert.deepEqual(
    hub.listCameraStatus().map((c) => c.name),
    ["A", "Alt"]
  );
  // Schon in dieser Runde abgefragt.
  assert.equal(camA.polls, 1);
  assert.equal(camOld.polls, 1);
  await until("Dauerverbindung der DoorBird", () => door.monitorRequests > 0);
  // Das Offenhalten aus der Datei gilt nicht.
  await quiet();
  assert.equal(door.opens, 0);
  assert.equal(holdOf(), null);
  assert.deepEqual(logged(new RegExp(SECRET)), []);
});

test("Weitere Fehlversuche: keine zweite Zeile, Abfrage mit der Kopie geht weiter, die Datei bleibt", async () => {
  await tick(16_000);
  await tick(16_000);
  assert.equal(cloud.listRequests, 3);
  assert.equal(logged(/^Kamera-Liste aus lokaler Kopie/).length, 1);
  assert.equal(camA.polls, 3);
  assert.equal(replaced.includes("cameras.json"), false);
  assert.equal(door.opens, 0);
});

test("Sobald die Cloud antwortet, ersetzt ihre Antwort die Kopie und den Stand im Speicher; die Datei ist nur fuer den Hub-Benutzer lesbar", async () => {
  cloud.listStatus = 200;
  // Die Cloud kennt ein Offenhalten, das schon vorbei ist: Es lebt nicht wieder auf.
  cloud.list = [reolink(1, "A Nord", camA, { deliveryMode: "OPEN" }), doorbird({ doorHoldUntil: iso(clock - MIN) })];
  await tick(16_000);
  await until("neue Kopie", () => savedAtOnDisk() === iso(clock));
  assert.equal(replaced.filter((f) => f === "cameras.json").length, 1);
  assert.deepEqual(
    hub.listCameraStatus().map((c) => c.name),
    ["A Nord"]
  );
  assert.equal(logged(/^Kamera-Liste: Cloud wieder erreichbar/).length, 1);
  assert.equal(modeOf(cacheFile), 0o600);
  const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as { version: number; savedAt: string; cameras: unknown[] };
  assert.equal(saved.version, 1);
  assert.equal(saved.savedAt, iso(clock));
  // Wie die Cloud geantwortet hat, ohne Offenhalten.
  assert.deepEqual(saved.cameras, [reolink(1, "A Nord", camA, { deliveryMode: "OPEN" }), doorbird()]);
  assert.equal(door.opens, 0);
  assert.equal(holdOf(), null);
  assert.deepEqual(logged(new RegExp(SECRET)), []);
});

test("Gleicher Inhalt: keine neue Datei; nach einem Tag ein neuer Zeitstempel", async () => {
  const writes = () => replaced.filter((f) => f === "cameras.json").length;
  const before = writes();
  await tick(61_000);
  for (let i = 0; i < 20; i++) await turn();
  assert.equal(cloud.listRequests, 5);
  assert.equal(writes(), before);
  await tick(DAY);
  await until("Kopie mit neuem Zeitstempel", () => savedAtOnDisk() === iso(clock));
  assert.equal(writes(), before + 1);
  assert.equal(modeOf(cacheFile), 0o600);
});

test("Beschaedigte Kopie: wird ignoriert und geloggt, ohne ihren Inhalt", async () => {
  // Ein zweiter Hub aus eigenem Verzeichnis, mit abgeschnittener Datei.
  const text = JSON.stringify({ version: 1, savedAt: iso(clock), cameras: [reolink(7, "B", camA)] });
  const hubDir = hubSandbox(text.slice(0, text.indexOf(SECRET) + 12));
  const second: typeof import("./cameras.js") = await import(pathToFileURL(path.join(hubDir, "src", "cameras.ts")).href);
  cloud.listStatus = 503;
  const lines = hubLog.length;
  await second.pollCameras();
  await quiet();
  assert.deepEqual(
    hubLog.slice(lines).filter((l) => /Kopie/.test(l)),
    ["Kamera-Liste: lokale Kopie nicht verwendet (beschädigt)"]
  );
  assert.deepEqual(second.listCameraStatus(), []);
  assert.deepEqual(logged(new RegExp(SECRET.slice(0, 12))), []);
});
