import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire, syncBuiltinESMExports } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { berlinWall } from "./camera-clock.js";

/*
 * Kamera-Uhren aus cameras.ts gegen Attrappen: eine Cloud und drei Kameras
 * auf 127.0.0.1. Die Regeln (Art der Abweichung, Plan) stehen in
 * camera-clock.ts und haben dort ihre Tests; hier steht, dass cameras.ts nur
 * liest (GetTime, GetNtp), die Einstellungen einmal am Tag holt, je Kamera
 * eine Plan-Zeile schreibt und bei einer Kamera ohne Antwort auf GetNtp
 * einmal loggt und es erst am naechsten Tag wieder versucht. Wie
 * camera-poll.test.ts: eine Kopie von hub/src in einem eigenen Verzeichnis,
 * die Uhr (Date) geht nur, wenn der Test sie stellt.
 */

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
let clock = T0;
mock.timers.enable({ apis: ["Date"], now: T0 });
const advance = (ms: number) => {
  clock += ms;
  mock.timers.setTime(clock);
};
const MIN = 60_000;

const noProgram = () => {
  throw new Error("im Test gesperrt");
};
Object.assign(childProcess, {
  exec: noProgram,
  execFile: noProgram,
  execSync: noProgram,
  execFileSync: noProgram,
  spawn: noProgram,
  spawnSync: noProgram,
  fork: noProgram,
});
syncBuiltinESMExports();

const dummies = new Set<string>();
const foreign: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!dummies.has(url.origin)) {
    foreign.push(url.origin + url.pathname);
    throw new Error("im Test gesperrt");
  }
  return realFetch(input, init);
}) as typeof fetch;

const hubLog: string[] = [];
mock.method(console, "log", (line: unknown) => {
  hubLog.push(String(line).replace(/^\[[^\]]*\] /, ""));
});
const logged = (what: RegExp) => hubLog.filter((line) => what.test(line));

interface ClockDummy {
  id: number;
  name: string;
  server: http.Server;
  /** Kamera-Uhr gegen die Berliner Wanduhr, in Sekunden. */
  offsetS: number;
  /** Reolink timeZone (Sekunden westlich von UTC). */
  timeZone: number;
  dst: number;
  ntp: { enable: number; server: string } | "error";
  cmds: string[];
}

function clockDummy(id: number, name: string, o: Partial<ClockDummy>): ClockDummy {
  const cam: ClockDummy = { id, name, server: http.createServer(), offsetS: 0, timeZone: -3600, dst: 1, ntp: { enable: 1, server: "192.168.1.1" }, cmds: [], ...o };
  cam.server.on("request", (req, res) => {
    res.setHeader("Connection", "close");
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const cmds = (JSON.parse(body || "[]") as Array<{ cmd: string }>).map((c) => c.cmd);
      cam.cmds.push(...cmds);
      const one = (cmd: string) => {
        if (cmd === "Login") return { cmd, code: 0, value: { Token: { name: "attrappe", leaseTime: 3600 } } };
        if (cmd === "GetMdState") return { cmd, code: 0, value: { state: 0 } };
        if (cmd === "GetTime") {
          const t = berlinWall(new Date(Date.now() + cam.offsetS * 1000));
          return {
            cmd,
            code: 0,
            value: {
              Time: { ...t, timeZone: cam.timeZone, timeFmt: "DD/MM/YYYY", hourFmt: 0 },
              Dst: { enable: cam.dst, offset: 1, startMon: 3, startWeek: 5, startWeekday: 0, startHour: 2, endMon: 10, endWeek: 5, endWeekday: 0, endHour: 3 },
            },
          };
        }
        if (cmd === "GetNtp") {
          return cam.ntp === "error"
            ? { cmd, code: 1, error: { rspCode: -9, detail: "not support" } }
            : { cmd, code: 0, value: { Ntp: { ...cam.ntp, port: 123, interval: 1440 } } };
        }
        return { cmd, code: 0, value: {} };
      };
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(cmds.map(one)));
    });
  });
  return cam;
}

const A = clockDummy(1, "Eingang", {});
const B = clockDummy(2, "Hof", { offsetS: -3600, timeZone: 0, dst: 0, ntp: { enable: 0, server: "" } });
const C = clockDummy(3, "Lager", { offsetS: 45, ntp: "error" });
const cams = [A, B, C];

const cloud = http.createServer((req, res) => {
  res.setHeader("Connection", "close");
  req.resume();
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/api/hub/cameras") {
      const list = cams.map((cam) => ({
        id: cam.id,
        name: cam.name,
        kind: "REOLINK",
        host: "127.0.0.1",
        macAddress: null,
        httpPort: (cam.server.address() as AddressInfo).port,
        https: false,
        username: "attrappe",
        password: "attrappe",
        channel: 0,
        vehicleDetection: false,
      }));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(list));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
});

let hub: typeof import("./cameras.js");
let memoFile = "";

function claimSandbox(): string {
  for (let n = 0; ; n++) {
    const dir = path.join(os.tmpdir(), `emp-hub-uhren-${n}`);
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

/**
 * Warten, bis `done` gilt, hoechstens `ms` echte Millisekunden (nur Date ist
 * gestellt, setTimeout laeuft echt). Eine feste Zahl von Runden reicht unter
 * Last nicht immer, bis die Attrappen geantwortet haben oder die Datei steht.
 */
async function waitFor(what: string, done: () => boolean, ms = 10_000): Promise<void> {
  const started = performance.now();
  while (!done()) {
    if (performance.now() - started > ms) throw new Error(`gewartet auf: ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

before(async () => {
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
  memoFile = path.join(hubDir, ".cache", "camera-clock.json");

  const servers = [cloud, ...cams.map((cam) => cam.server)];
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))));
  for (const server of servers) dummies.add(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  for (const key of Object.keys(process.env)) if (/^(HUB|FACE)_/.test(key)) delete process.env[key];
  process.env.HUB_API_URL = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}`;
  process.env.HUB_API_TOKEN = "attrappe";
  process.env.HUB_IMPROVE_LOG = "0";

  hub = await import(pathToFileURL(path.join(hubDir, "src", "cameras.ts")).href);
  await hub.pollCameras();
  await waitFor("alle drei Attrappen erreichbar", () => hub.listCameraStatus().every((c) => c.reachable));
});

after(() => {
  for (const server of [cloud, ...cams.map((cam) => cam.server)]) {
    server.closeAllConnections();
    server.unref();
  }
  mock.timers.reset();
  assert.deepEqual(foreign, [], "der Hub spricht im Test nur mit den Attrappen");
});

/** Befehle zur Uhr (alles mit Time, Ntp oder Dst im Namen), ab `from`. */
const clockCmds = (cam: ClockDummy, from: number) => cam.cmds.slice(from).filter((c) => /Time|Ntp|Dst/.test(c));

test("Erster Lauf: Uhrzeit und Einstellungen gelesen, eine Plan-Zeile je Kamera, Art in der Sammelzeile", async () => {
  const from = cams.map((c) => c.cmds.length);
  await hub.refreshCameraClocks(true);
  assert.deepEqual(clockCmds(A, from[0]), ["GetTime", "GetNtp"]);
  assert.deepEqual(clockCmds(B, from[1]), ["GetTime", "GetNtp"]);
  assert.deepEqual(clockCmds(C, from[2]), ["GetTime", "GetNtp"]);
  // Eine Zeile je betroffener Kamera; Eingang ist im Takt und hat nichts umzustellen.
  assert.deepEqual(logged(/^Kamera-Uhr /), [
    "Kamera-Uhr Hof: -3600 s (Zeitzone); Zeitzone UTC+0, Sommerzeit aus, Zeitserver aus – Vorschlag: Zeitzone UTC+1 statt UTC+0, Sommerzeit einschalten (EU-Regel), Zeitserver einschalten (nicht umgestellt)",
    "Kamera-Uhr Lager: +45 s (Drift); Zeitzone UTC+1, Sommerzeit an (EU-Regel) – Vorschlag: Uhr stellen oder Zeitserver prüfen (nicht umgestellt)",
  ]);
  assert.equal(logged(/^Kamera Lager: Zeitserver-Einstellung nicht lesbar/).length, 1);
  assert.deepEqual(logged(/^Kamera-Uhren weichen ab/), ["Kamera-Uhren weichen ab: Hof -3600 s (Zeitzone, NTP aus), Lager +45 s (Drift)"]);
  const status = Object.fromEntries(hub.listCameraStatus().map((c) => [c.name, c.clock]));
  assert.equal(status.Hof?.kind, "zeitzone");
  assert.deepEqual(status.Eingang?.plan, []);
  // Gemerkt fuer einen Neustart, ohne Zugangsdaten (geschrieben im Hintergrund).
  const read = () => (fs.existsSync(memoFile) ? fs.readFileSync(memoFile, "utf8") : "");
  await waitFor("Merkdatei mit allen drei Kameras", () => /"3":/.test(read()));
  const memo = read();
  assert.doesNotMatch(memo, /attrappe/);
  assert.deepEqual(Object.keys(JSON.parse(memo).cameras).sort(), ["1", "2", "3"]);
});

test("Nach 30 min: nur die Uhrzeit, kein GetNtp, keine neue Zeile; nach einem Tag wieder", async () => {
  const from = cams.map((c) => c.cmds.length);
  const lines = hubLog.length;
  advance(30 * MIN);
  await hub.refreshCameraClocks();
  for (const [i, cam] of cams.entries()) assert.deepEqual(clockCmds(cam, from[i]), ["GetTime"], cam.name);
  assert.deepEqual(hubLog.slice(lines), []);

  advance(24 * 60 * MIN);
  const day = cams.map((c) => c.cmds.length);
  await hub.refreshCameraClocks();
  for (const [i, cam] of cams.entries()) assert.deepEqual(clockCmds(cam, day[i]), ["GetTime", "GetNtp"], cam.name);
  // Einmal am Tag je betroffener Kamera die Zeile; die gescheiterte Abfrage steht nicht noch einmal da.
  assert.equal(logged(/^Kamera-Uhr Hof/).length, 2);
  assert.equal(logged(/^Kamera-Uhr Lager/).length, 2);
  assert.equal(logged(/^Kamera-Uhr Eingang/).length, 0);
  assert.equal(logged(/^Kamera Lager: Zeitserver-Einstellung nicht lesbar/).length, 1);
});

test("Aenderung: eine neue Zeile nur fuer die Kamera, deren Lage sich aendert", async () => {
  const lines = hubLog.length;
  A.offsetS = 3600;
  advance(30 * MIN);
  await hub.refreshCameraClocks();
  assert.deepEqual(
    hubLog.slice(lines).filter((l) => /^Kamera-Uhr /.test(l)),
    ["Kamera-Uhr Eingang: +3600 s (Zeitzone); Zeitzone UTC+1, Sommerzeit an (EU-Regel), Zeitserver an (im Standort-Netz 192.168.1.1) – Vorschlag: Zeitzone und Sommerzeit prüfen (Abweichung +1 h) (nicht umgestellt)"]
  );
});

test("Wieder im Takt: einmal eine Zeile, danach keine mehr fuer diese Kamera", async () => {
  const lines = hubLog.length;
  A.offsetS = 0;
  advance(30 * MIN);
  await hub.refreshCameraClocks();
  assert.deepEqual(
    hubLog.slice(lines).filter((l) => /^Kamera-Uhr /.test(l)),
    ["Kamera-Uhr Eingang: im Takt; Zeitzone UTC+1, Sommerzeit an (EU-Regel), Zeitserver an (im Standort-Netz 192.168.1.1) – nichts umzustellen"]
  );
  const back = hubLog.length;
  advance(30 * MIN);
  await hub.refreshCameraClocks();
  advance(24 * 60 * MIN);
  await hub.refreshCameraClocks();
  const later = hubLog.slice(back).filter((l) => /^Kamera-Uhr /.test(l));
  assert.deepEqual(later.filter((l) => /^Kamera-Uhr Eingang/.test(l)), []);
  // Die betroffenen Kameras stehen weiter einmal am Tag im Log.
  assert.deepEqual(later.map((l) => l.split(":")[0]), ["Kamera-Uhr Hof", "Kamera-Uhr Lager"]);
});

test("Nur lesende Befehle an die Kameras", () => {
  for (const cam of cams) {
    assert.deepEqual(
      [...new Set(cam.cmds)].filter((c) => /^Set/.test(c)),
      [],
      cam.name
    );
  }
});
