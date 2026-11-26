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
import { parseCameraMarks, serializeCameraMarks } from "./camera-marks-rules.js";

/*
 * Die Kamera-Abfrage aus cameras.ts gegen Attrappen: eine Cloud und acht
 * Kameras auf 127.0.0.1. Die Regeln der Abfrage stehen in
 * camera-poll-rules.ts und haben dort ihre Tests; hier steht, dass die
 * Abfrage sie benutzt.
 *
 * cameras.ts liest beim Laden hub/.env und arbeitet in hub/.cache. Der Test
 * laesst beides in Ruhe: Er laedt eine Kopie von hub/src aus einem eigenen
 * Verzeichnis, ohne .env und mit eigenem .cache. Die Uhr (Date) steht und
 * geht nur, wenn der Test sie stellt; 30 s und 5 min kosten so keine
 * Wartezeit. Die Tests teilen sich den einen Hub und laufen in dieser
 * Reihenfolge: Was eine Kamera in einem Test tut, gilt im naechsten weiter.
 */

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0);
let clock = T0;
mock.timers.enable({ apis: ["Date"], now: T0 });
const advance = (ms: number) => {
  clock += ms;
  mock.timers.setTime(clock);
};

/* ------------------------------------------ nichts verlaesst den Test */

// Der Hub startet im Test keine Programme (git, arp): Jeder Versuch
// scheitert, wie auf einem Rechner ohne das Programm.
const noProgram = () => {
  throw new Error("im Test gesperrt");
};
/**
 * Ausnahmen, die ein Test setzt: Attrappe je Programm, nur ueber execFile
 * (so ruft image.ts `sips`). Sie bekommt die Argumente; ohne Eintrag
 * scheitert der Aufruf wie alle anderen.
 */
const programs = new Map<string, (args: string[]) => void>();
const execFileStub = (file: unknown, args: unknown, ...rest: unknown[]) => {
  const fake = typeof file === "string" ? programs.get(file) : undefined;
  if (!fake) return noProgram();
  const done = rest.find((r) => typeof r === "function") as ((err: Error | null, out?: unknown) => void) | undefined;
  let err: Error | null = null;
  try {
    fake(Array.isArray(args) ? args.map(String) : []);
  } catch (e) {
    err = e instanceof Error ? e : new Error(String(e));
  }
  setImmediate(() => done?.(err, { stdout: "", stderr: "" }));
};
Object.assign(childProcess, {
  exec: noProgram,
  execFile: execFileStub,
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
// Beides gilt damit auch fuer `import { execFile } from "node:child_process"` im Hub.
syncBuiltinESMExports();

/** Adressen der Attrappen. Alles andere erreicht der Hub im Test nicht. */
const dummies = new Set<string>();
/** Wohin er trotzdem wollte. */
const foreign: string[] = [];
/** Anfragen des Hubs, auf deren Antwort er noch wartet oder die er noch liest. */
let pending = 0;
const track = <T>(work: Promise<T>): Promise<T> => {
  pending++;
  return work.finally(() => {
    pending--;
  });
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!dummies.has(url.origin)) {
    foreign.push(url.origin + url.pathname);
    throw new Error("im Test gesperrt");
  }
  const res = await track(realFetch(input, init));
  for (const read of ["json", "text", "arrayBuffer"] as const) {
    const original = res[read].bind(res) as () => Promise<unknown>;
    Object.defineProperty(res, read, { value: () => track(original()) });
  }
  return res;
}) as typeof fetch;

/** Zeilen, die der Hub ins Log schreibt, ohne die Zeit davor. */
const hubLog: string[] = [];
mock.method(console, "log", (line: unknown) => {
  hubLog.push(String(line).replace(/^\[[^\]]*\] /, ""));
});
const logged = (what: RegExp) => hubLog.filter((line) => what.test(line));

/* ---------------------------------------------------------- Attrappen */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

interface CameraDummy {
  id: number;
  name: string;
  server: http.Server;
  /** Die Abfrage der Alarme: beantworten, ablehnen (503) oder die Antwort zurueckhalten. */
  mode: "ok" | "fail" | "hold";
  motion: boolean;
  /** Abfragen der Alarme, die angekommen sind. */
  polls: number;
  /** Bilder, die der Hub geholt hat. */
  snaps: number;
  /** Zurueckgehaltene Antworten. */
  held: Array<(ok: boolean) => void>;
}

function cameraDummy(id: number, name: string): CameraDummy {
  const cam: CameraDummy = { id, name, server: http.createServer(), mode: "ok", motion: false, polls: 0, snaps: 0, held: [] };
  cam.server.on("request", (req, res) => {
    // Jede Anfrage auf einer eigenen Verbindung: Am Ende bleibt keine offen.
    res.setHeader("Connection", "close");
    if (new URL(req.url ?? "/", "http://x").searchParams.get("cmd") === "Snap") {
      cam.snaps++;
      res.writeHead(200, { "Content-Type": "image/jpeg" }).end(JPEG);
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const cmds = (JSON.parse(body) as Array<{ cmd: string }>).map((c) => c.cmd);
      const answer = (ok: boolean) => {
        if (!ok) return void res.writeHead(503).end();
        const value = (cmd: string) =>
          cmd === "Login" ? { Token: { name: "attrappe", leaseTime: 3600 } } : cmd === "GetMdState" ? { state: cam.motion ? 1 : 0 } : {};
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(cmds.map((cmd) => ({ cmd, code: 0, value: value(cmd) }))));
      };
      // Anmeldung und alles andere klappt immer; es geht um die Abfrage.
      if (!cmds.includes("GetMdState")) return answer(true);
      cam.polls++;
      if (cam.mode === "hold") cam.held.push(answer);
      else answer(cam.mode === "ok");
    });
  });
  return cam;
}

/** Zurueckgehaltene Antworten jetzt geben, so wie die Kamera gerade eingestellt ist. */
function release(cam: CameraDummy): void {
  for (const answer of cam.held.splice(0)) answer(cam.mode === "ok");
}

const cams = ["A", "B", "C", "D", "E", "F", "G", "H"].map((name, i) => cameraDummy(i + 1, name));
const [A, B, C] = cams;

const cloud = {
  server: http.createServer(),
  /** Status, mit dem die Cloud ein Anzeige-Bild beantwortet. */
  snapshotStatus: 200,
};
cloud.server.on("request", (req, res) => {
  res.setHeader("Connection", "close");
  req.resume();
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/api/hub/cameras") {
      // Ohne MAC-Adresse sucht der Hub eine Kamera, die nicht antwortet, nicht im Netz.
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
    const status = /\/snapshot$/.test(url.pathname) ? cloud.snapshotStatus : 200;
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: status === 200 }));
  });
});

/* ----------------------------------------------------------- der Hub */

let hub: typeof import("./cameras.js");
let STATE: (typeof import("./state.js"))["STATE"];
let improveLog: typeof import("./improve-log.js");
let marksFile = "";
/** Was C laut Merker beim Start schon aussteht. */
const C_DOWN_SINCE = T0 - 3 * 3_600_000;

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Warten, bis `done` gilt. Die Uhr des Tests steht dabei; die Grenze misst die echte. */
async function until(what: string | (() => string), done: () => boolean): Promise<void> {
  const started = performance.now();
  while (!done()) {
    if (performance.now() - started > 30_000) throw new Error(`gewartet auf: ${typeof what === "string" ? what : what()}`);
    await turn();
  }
}

/**
 * Warten, bis der Hub von den Attrappen nichts mehr erwartet, bis auf `open`
 * Antworten, die die Kameras zurueckhalten. Was er auf eine Antwort hin tut,
 * hat er dann getan: Zwischen einer Antwort und seiner naechsten Anfrage
 * wartet er auf nichts anderes.
 */
async function quiet(open = 0): Promise<void> {
  const held = () => cams.reduce((n, cam) => n + cam.held.length, 0);
  let calm = 0;
  await until(
    () => `${open} offene Anfragen (der Hub wartet auf ${pending}, die Kameras halten ${held()} zurueck)`,
    () => {
      calm = pending === open && held() === open ? calm + 1 : 0;
      return calm > 3;
    },
  );
}

/** Die Uhr um einen Takt vorstellen und die Abfrage ausloesen. */
async function tick(): Promise<void> {
  advance(hub.CAMERA_POLL_INTERVAL_MS);
  await hub.pollCameras();
}

/**
 * Eigenes Verzeichnis fuer diesen Lauf: der erste freie Name einer festen
 * Reihe, kein zufaelliger. tsx merkt sich uebersetzte Dateien je Pfad; mit
 * immer neuen Pfaden wuechse sein Zwischenspeicher mit jedem Lauf.
 */
function claimSandbox(): string {
  for (let n = 0; ; n++) {
    const dir = path.join(os.tmpdir(), `emp-hub-abfrage-${n}`);
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
  const hubDir = path.join(sandbox, "hub");
  fs.cpSync(path.dirname(fileURLToPath(import.meta.url)), path.join(hubDir, "src"), {
    recursive: true,
    filter: (file) => !file.endsWith(".test.ts"),
  });
  fs.writeFileSync(path.join(hubDir, "package.json"), JSON.stringify({ type: "module" }));
  // Pakete (dotenv) von dort, wo auch dieser Test sie findet.
  const dotenv = createRequire(import.meta.url).resolve("dotenv");
  const modules = `${path.sep}node_modules${path.sep}`;
  fs.symlinkSync(dotenv.slice(0, dotenv.lastIndexOf(modules) + modules.length), path.join(hubDir, "node_modules"), "dir");

  marksFile = path.join(hubDir, ".cache", "cameras-down.json");
  fs.mkdirSync(path.dirname(marksFile));
  fs.writeFileSync(marksFile, serializeCameraMarks(new Map([[C.id, C_DOWN_SINCE]])));

  const servers = [cloud.server, ...cams.map((cam) => cam.server)];
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))));
  for (const server of servers) dummies.add(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  // Nichts aus der Umgebung des Rechners gilt fuer den Hub im Test.
  for (const key of Object.keys(process.env)) if (/^(HUB|FACE)_/.test(key)) delete process.env[key];
  process.env.HUB_API_URL = `http://127.0.0.1:${(cloud.server.address() as AddressInfo).port}`;
  process.env.HUB_API_TOKEN = "attrappe";

  hub = await import(pathToFileURL(path.join(hubDir, "src", "cameras.ts")).href);
  ({ STATE } = await import(pathToFileURL(path.join(hubDir, "src", "state.ts")).href));
  improveLog = await import(pathToFileURL(path.join(hubDir, "src", "improve-log.ts")).href);

  // Erster Takt: A und D bis H antworten, B und C lehnen ab.
  B.mode = "fail";
  C.mode = "fail";
  await hub.pollCameras();
  await quiet();
});

after(async () => {
  for (const cam of cams) release(cam);
  await quiet();
  // Der Hub sammelt Meldungen an die Cloud kurz, bevor er sie schickt: Die
  // Attrappen bleiben fuer eine letzte stehen, halten den Prozess aber nicht auf.
  for (const server of [cloud.server, ...cams.map((cam) => cam.server)]) server.unref();
  assert.deepEqual(foreign, [], "der Hub spricht im Test nur mit den Attrappen");
});

test("Abfrage: lehnt eine Kamera sofort ab, ist sie im naechsten Takt wieder dran", async () => {
  assert.deepEqual(logged(/^Kamera [A-H]: HTTP/).sort(), ["Kamera B: HTTP 503", "Kamera C: HTTP 503"]);
  assert.deepEqual(
    hub.listCameraStatus().map((cam) => `${cam.name}${cam.reachable ? "" : " fehlt"}`),
    ["A", "B fehlt", "C fehlt", "D", "E", "F", "G", "H"],
  );
  const [a, b, c] = [A.polls, B.polls, C.polls];
  await tick();
  await quiet();
  assert.deepEqual([A.polls - a, B.polls - b, C.polls - c], [1, 1, 1]);
});

test("Abfrage: antwortet eine Kamera 5 s nicht und lehnt dann ab, ist sie im naechsten Takt wieder dran; als langsame Abfrage zaehlt das nicht", async () => {
  const [a, b] = [A.polls, B.polls];
  B.mode = "hold";
  await tick();
  await quiet(1);
  await tick();
  await quiet(1);
  // Solange die Abfrage laeuft, beginnt an B keine zweite; A wird weiter gefragt.
  assert.deepEqual([A.polls - a, B.polls - b], [2, 1]);
  await tick();
  await quiet(1);
  advance(1000);
  B.mode = "fail";
  release(B);
  await quiet();
  // Der naechste Takt, 6 s nach Beginn der langen Abfrage.
  advance(1000);
  await hub.pollCameras();
  await quiet();
  assert.deepEqual([A.polls - a, B.polls - b], [4, 2]);
  // Die Dauer zaehlt nur fuer Abfragen, die gelingen.
  assert.deepEqual(logged(/Abfrage dauerte/), []);
  assert.equal(STATE.cameras.pollSlow, 0);
});

test("Abfrage: eine Antwort nach 5 s zaehlt als langsame Abfrage und steht im Log", async () => {
  A.mode = "hold";
  await tick();
  await quiet(1);
  advance(5000);
  A.mode = "ok";
  release(A);
  await quiet();
  await tick();
  await quiet();
  assert.deepEqual(logged(/Abfrage dauerte/), ["Kamera A: Abfrage dauerte 5.0 s (die anderen Kameras laufen weiter)"]);
  assert.equal(STATE.cameras.pollSlow, 1);
  assert.equal(STATE.cameras.pollSlowest, "A");
});

test("Abfrage: sind mehr Kameras faellig als Plaetze frei, kommen die zuerst dran, die antworten oder sofort ablehnen", async () => {
  // C antwortet 5 s nicht, wie eine Kamera, die haengt; B lehnt weiter sofort ab.
  C.mode = "hold";
  await tick();
  await quiet(1);
  advance(5000);
  C.mode = "fail";
  release(C);
  await quiet();
  // Im naechsten Takt sind alle acht faellig und halten ihre Antwort zurueck:
  // Sechs Abfragen laufen nebeneinander, zwei Kameras warten auf einen Platz.
  const modes = cams.map((cam) => cam.mode);
  let running: string[] = [];
  try {
    for (const cam of cams) cam.mode = "hold";
    await tick();
    await quiet(6);
    running = cams.filter((cam) => cam.held.length > 0).map((cam) => cam.name);
  } finally {
    cams.forEach((cam, i) => (cam.mode = modes[i]));
    for (const cam of cams) release(cam);
  }
  await quiet();
  // In der Reihenfolge der Kamera-Liste, C zuletzt: Es warten H und C.
  assert.deepEqual(running, ["A", "B", "D", "E", "F", "G"]);
});

test("Anzeige-Bild ohne Cloud: 30 s lang kein zweites, und je Grund steht alle 5 min eine Zeile im Log", async () => {
  const firstAt = clock + hub.CAMERA_POLL_INTERVAL_MS;
  /** Eine neue Bewegung an A, `s` Sekunden nach der ersten: Alarm fuer einen Takt. */
  const motionAfter = async (s: number) => {
    advance(firstAt + s * 1000 - hub.CAMERA_POLL_INTERVAL_MS - clock);
    A.motion = true;
    await tick();
    await quiet();
    A.motion = false;
    await tick();
    await quiet();
  };
  const snapsBefore = A.snaps;
  const snaps = () => A.snaps - snapsBefore;
  const failed = () => logged(/^Auto-Snapshot/).map((line) => line.replace(/^.*: /, ""));

  cloud.snapshotStatus = 500;
  await motionAfter(0);
  assert.equal(snaps(), 1);
  assert.deepEqual(logged(/^Auto-Snapshot/), ["Auto-Snapshot A (Kamera 1) fehlgeschlagen: Snapshot-Upload fehlgeschlagen: HTTP 500"]);
  // Das Bild ist geholt, auch wenn die Cloud es nicht nahm: 30 s lang kein neues.
  await motionAfter(4);
  await motionAfter(30);
  assert.equal(snaps(), 1);
  // Danach wieder eins; derselbe Grund steht kein zweites Mal im Log.
  await motionAfter(34);
  assert.equal(snaps(), 2);
  assert.deepEqual(failed(), ["HTTP 500"]);
  // Ein anderer Grund steht sofort da.
  cloud.snapshotStatus = 503;
  await motionAfter(68);
  assert.equal(snaps(), 3);
  assert.deepEqual(failed(), ["HTTP 500", "HTTP 503"]);
  // Der erste Grund kurz vor Ablauf der 5 min: keine Zeile. Danach wieder eine.
  cloud.snapshotStatus = 500;
  await motionAfter(298);
  assert.equal(snaps(), 4);
  assert.deepEqual(failed(), ["HTTP 500", "HTTP 503"]);
  await motionAfter(332);
  assert.equal(snaps(), 5);
  assert.deepEqual(failed(), ["HTTP 500", "HTTP 503", "HTTP 500"]);
});

test("Vorschaubild bei reiner Bewegung: sofort, bis eins angekommen ist, dann hoechstens alle 300 s", async () => {
  const statusBefore = cloud.snapshotStatus;
  cloud.snapshotStatus = 200;
  // Abstand zum letzten (gescheiterten) Bild des vorigen Tests.
  advance(31_000);
  const firstAt = clock + hub.CAMERA_POLL_INTERVAL_MS;
  const motionAfter = async (s: number) => {
    advance(firstAt + s * 1000 - hub.CAMERA_POLL_INTERVAL_MS - clock);
    A.motion = true;
    await tick();
    await quiet();
    A.motion = false;
    await tick();
    await quiet();
  };
  const count = (key: string) => improveLog.improveSnapshot().counts[`camera.${key}`] ?? 0;
  const [snapsBefore, uploadsBefore, skipsBefore, bytesBefore] = [A.snaps, count("preview_upload"), count("preview_skip"), count("preview_bytes")];
  const snaps = () => A.snaps - snapsBefore;
  const logBefore = hubLog.length;

  // Bisher kam seit dem Start kein Bild von A an: sofort.
  await motionAfter(0);
  assert.equal(snaps(), 1);
  // Mit 30 s Abstand waeren das zwei weitere Bilder gewesen.
  await motionAfter(40);
  await motionAfter(299);
  assert.equal(snaps(), 1);
  await motionAfter(304);
  assert.equal(snaps(), 2);
  assert.equal(count("preview_upload") - uploadsBefore, 2);
  assert.equal(count("preview_skip") - skipsBefore, 2);
  assert.equal(count("preview_bytes") - bytesBefore, 2 * JPEG.length);
  // Keine Zeile je Bild.
  assert.deepEqual(hubLog.slice(logBefore).filter((line) => /snapshot|vorschau|bild/i.test(line)), []);
  cloud.snapshotStatus = statusBefore;
});

test("Vorschaubild bei reiner Bewegung: auch ein kleines Kamerabild geht verkleinert auf 960 px mit Qualitaet 70 hinaus", async () => {
  // Wie auf dem Mac: image.ts verkleinert mit `sips` (hier eine Attrappe,
  // die ein kleineres JPEG schreibt). Das Bild der Kamera hat nur wenige
  // Bytes, weit unter den 200 KB, ab denen andere Bilder verkleinert werden.
  const statusBefore = cloud.snapshotStatus;
  cloud.snapshotStatus = 200;
  const SMALLER = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00]);
  const calls: string[][] = [];
  programs.set("sips", (args) => {
    calls.push(args);
    fs.writeFileSync(args[args.length - 1], SMALLER);
  });
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  const count = (key: string) => improveLog.improveSnapshot().counts[`camera.${key}`] ?? 0;
  const [uploadsBefore, bytesBefore] = [count("preview_upload"), count("preview_bytes")];
  try {
    // Abstand zum letzten Vorschaubild von A (voriger Test): mehr als 300 s.
    advance(310_000);
    A.motion = true;
    await tick();
    await until("Vorschaubild hochgeladen", () => count("preview_upload") > uploadsBefore);
    A.motion = false;
    await tick();
    await quiet();
  } finally {
    Object.defineProperty(process, "platform", platform);
    programs.delete("sips");
    cloud.snapshotStatus = statusBefore;
  }
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0][0], calls[0][1], calls[0][6], calls[0][7]], ["-Z", "960", "formatOptions", "70"]);
  assert.equal(count("preview_upload") - uploadsBefore, 1);
  assert.equal(count("preview_bytes") - bytesBefore, SMALLER.length);
});

test("Ausfallbeginn auf der Platte: beim Start gelesen, bei Beginn und Ende eines Ausfalls je einmal geschrieben", async () => {
  const marks = () => parseCameraMarks(fs.readFileSync(marksFile, "utf8"), Date.now());
  const writes = () => replaced.filter((file) => file === path.basename(marksFile)).length;
  // B antwortet seit dem ersten Takt nicht, C laut Merker seit drei Stunden.
  // Beide wurden seither viele Male gefragt: geschrieben hat der Hub einmal.
  await until("Ausfallbeginn von B auf der Platte", () => marks().has(B.id));
  assert.deepEqual(
    marks(),
    new Map([
      [C.id, C_DOWN_SINCE],
      [B.id, T0],
    ]),
  );
  assert.equal(writes(), 1);
  // B antwortet wieder.
  B.mode = "ok";
  await tick();
  await until("Merker von B geloescht", () => !marks().has(B.id));
  assert.deepEqual(marks(), new Map([[C.id, C_DOWN_SINCE]]));
  assert.equal(writes(), 2);
});
