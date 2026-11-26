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

/*
 * Die Parkmeldung aus parking.ts gegen Attrappen: Cloud und Park-Tracker auf
 * 127.0.0.1, die Kiosk-Konfiguration (webcams/config.json) in einem eigenen
 * Verzeichnis. Die Regeln stehen in parking-rules.ts und haben dort ihre
 * Tests; hier steht, dass reportParking sie benutzt.
 *
 * Wie in camera-poll.test.ts: Der Test laedt eine Kopie von hub/src ohne
 * .env und mit eigenem .cache. Die Uhr (Date) steht und geht nur, wenn der
 * Test sie stellt. Die Tests teilen sich den einen Hub und laufen in dieser
 * Reihenfolge.
 */

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0);
let clock = T0;
mock.timers.enable({ apis: ["Date"], now: T0 });
const advance = (ms: number) => {
  clock += ms;
  mock.timers.setTime(clock);
};
/** Ein Takt der Parkmeldung (index.ts). */
const TICK_MS = 30_000;

/* ------------------------------------------ nichts verlaesst den Test */

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

/** Adressen der Attrappen. Alles andere erreicht der Hub im Test nicht. */
const dummies = new Set<string>();
/** Wohin er trotzdem wollte. */
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

/** Zeilen, die der Hub ins Log schreibt, ohne die Zeit davor. */
const hubLog: string[] = [];
mock.method(console, "log", (line: unknown) => {
  hubLog.push(String(line).replace(/^\[[^\]]*\] /, ""));
});
const logged = (what: RegExp) => hubLog.filter((line) => what.test(line));

/* ---------------------------------------------------------- Attrappen */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
/** Adresse der Park-Kamera (Testnetz; der Hub fragt sie in diesem Test nie selbst ab). */
const PARK_HOST = "192.0.2.10";
const PASSWORD = "attrappe-kennwort";
const PARK_CAMERA_ID = 42;

/** Anfragen an die Cloud: „Methode Pfad“. */
const cloudCalls: string[] = [];
const calls = (what: string) => cloudCalls.filter((c) => c === what).length;
const cloud = {
  server: http.createServer(),
  /** Status der Antwort auf die Parkmeldung. */
  parkingStatus: 200,
  /** Antworten auf die Parkmeldung zurueckhalten (Cloud haengt). */
  holdParking: false,
  held: [] as Array<() => void>,
  /** Kennt die Kamera-Liste der Cloud die Park-Kamera? */
  listHasPark: false,
  /** Query der hochgeladenen Bilder, in Reihenfolge. */
  frameQueries: [] as string[],
  /** Rumpf der Parkmeldungen (JSON), in Reihenfolge. */
  reports: [] as Array<{ parking: { trackerOnline: boolean; lots: Array<Record<string, unknown>> } }>,
};
cloud.server.on("request", (req, res) => {
  res.setHeader("Connection", "close");
  const chunks: Buffer[] = [];
  req.on("data", (d: Buffer) => chunks.push(d));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    cloudCalls.push(`${req.method} ${url.pathname}`);
    if (url.pathname === `/api/hub/cameras/${PARK_CAMERA_ID}/snapshot`) cloud.frameQueries.push(url.search);
    if (url.pathname === "/api/hub/parking") cloud.reports.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const json = (status: number, value: unknown) =>
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    if (req.method === "GET" && url.pathname === "/api/hub/cameras") {
      const park = {
        id: PARK_CAMERA_ID,
        name: "Halle",
        kind: "REOLINK",
        host: PARK_HOST,
        macAddress: null,
        httpPort: 80,
        https: false,
        username: "admin",
        password: PASSWORD,
        channel: 0,
        vehicleDetection: false,
      };
      return json(200, cloud.listHasPark ? [park] : []);
    }
    if (url.pathname === "/api/hub/cameras/ensure") return json(200, { created: false });
    if (url.pathname === "/api/hub/parking") {
      const answer = () => json(cloud.parkingStatus, { ok: cloud.parkingStatus === 200 });
      if (cloud.holdParking) cloud.held.push(answer);
      else answer();
      return;
    }
    json(200, { ok: true });
  });
});

const tracker = {
  server: http.createServer(),
  count: 3,
  lastUpdate: 1_700_000_000,
  lastError: null as string | null,
  /** Tor-Automatik der Flaeche, wie der Tracker sie meldet; undefined = aelterer Tracker ohne Angabe. */
  gate: { opens: false, reason: "DoorBird öffnen aus, keine Geräte" } as { opens: boolean; reason: string } | undefined,
  /** Tracker antwortet nicht (503 auf alles). */
  down: false,
};
tracker.server.on("request", (req, res) => {
  res.setHeader("Connection", "close");
  req.resume();
  const url = new URL(req.url ?? "/", "http://x");
  if (tracker.down) return void res.writeHead(503).end();
  if (url.pathname === "/counters") {
    const counters = {
      halle: {
        count: tracker.count,
        lastUpdate: tracker.lastUpdate,
        lastError: tracker.lastError,
        fps: 5,
        ...(tracker.gate ? { gate: tracker.gate } : {}),
      },
    };
    return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ counters }));
  }
  if (url.pathname === "/debug/halle/snapshot.jpg") return void res.writeHead(200, { "Content-Type": "image/jpeg" }).end(JPEG);
  res.writeHead(404).end();
});

/* ----------------------------------------------------------- der Hub */

let parking: typeof import("./parking.js");
let improveLog: typeof import("./improve-log.js");
let kioskFile = "";
const count = (key: string) => improveLog.improveSnapshot().counts[`parking.${key}`] ?? 0;

/** Kiosk-Konfiguration mit einer Parkflaeche (Tracker-Attrappe); `gate`: weitere Felder von vehicleGate. */
function writeKiosk(port = 80, gate: Record<string, unknown> = {}): void {
  const url = `http://127.0.0.1:${(tracker.server.address() as AddressInfo).port}`;
  const cfg = {
    settings: { tracker: { url } },
    cams: [
      {
        id: "halle",
        name: "Halle",
        ip: PARK_HOST,
        port,
        username: "admin",
        password: PASSWORD,
        channel: 0,
        vehicleGate: { enabled: true, zone: null, ...gate },
      },
    ],
  };
  fs.writeFileSync(kioskFile, JSON.stringify(cfg));
}

/** Ein Lauf der Parkmeldung, einen Takt nach dem letzten. */
async function tick(): Promise<void> {
  advance(TICK_MS);
  await parking.reportParking();
}

function claimSandbox(): string {
  for (let n = 0; ; n++) {
    const dir = path.join(os.tmpdir(), `emp-hub-parken-${n}`);
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
  const dotenv = createRequire(import.meta.url).resolve("dotenv");
  const modules = `${path.sep}node_modules${path.sep}`;
  fs.symlinkSync(dotenv.slice(0, dotenv.lastIndexOf(modules) + modules.length), path.join(hubDir, "node_modules"), "dir");
  fs.mkdirSync(path.join(sandbox, "webcams"));
  kioskFile = path.join(sandbox, "webcams", "config.json");

  const servers = [cloud.server, tracker.server];
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))));
  for (const server of servers) dummies.add(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  writeKiosk();
  for (const key of Object.keys(process.env)) if (/^(HUB|FACE)_/.test(key)) delete process.env[key];
  process.env.HUB_API_URL = `http://127.0.0.1:${(cloud.server.address() as AddressInfo).port}`;
  process.env.HUB_API_TOKEN = "attrappe";

  parking = await import(pathToFileURL(path.join(hubDir, "src", "parking.ts")).href);
  improveLog = await import(pathToFileURL(path.join(hubDir, "src", "improve-log.ts")).href);
});

after(() => {
  for (const server of [cloud.server, tracker.server]) server.unref();
  assert.deepEqual(foreign, [], "der Hub spricht im Test nur mit den Attrappen");
  assert.deepEqual(logged(new RegExp(PASSWORD)), [], "das Kennwort der Kamera steht nie im Log");
});

test("Park-Kamera gerade angelegt: ohne Kamera-Nummer kein Bild, die Kamera-Liste wird hoechstens alle 5 min neu geladen", async () => {
  await parking.reportParking();
  assert.equal(calls("POST /api/hub/cameras/ensure"), 1);
  assert.equal(calls("POST /api/hub/parking"), 1);
  // Der Hub kennt die Kamera nicht: Liste einmal geladen, sie fehlt dort noch.
  assert.equal(calls("GET /api/hub/cameras"), 1);
  assert.equal(count("frame_nocam"), 1);
  await tick();
  assert.equal(calls("GET /api/hub/cameras"), 1);
  assert.equal(count("frame_nocam"), 2);
  // 5 min spaeter kennt die Cloud die Kamera: neu geladen, das Bild geht hoch.
  cloud.listHasPark = true;
  advance(5 * 60_000 - TICK_MS);
  await tick();
  assert.equal(calls("GET /api/hub/cameras"), 2);
  assert.equal(calls(`POST /api/hub/cameras/${PARK_CAMERA_ID}/snapshot`), 1);
  assert.equal(count("frame"), 1);
});

test("Ohne Aenderung: Meldung und Tracker-Bild bei jedem Lauf, weder Sicherstellen noch Kamera-Liste", async () => {
  const [ensure, list, report, frames] = [
    calls("POST /api/hub/cameras/ensure"),
    calls("GET /api/hub/cameras"),
    calls("POST /api/hub/parking"),
    calls(`POST /api/hub/cameras/${PARK_CAMERA_ID}/snapshot`),
  ];
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(calls("POST /api/hub/cameras/ensure") - ensure, 0);
  assert.equal(calls("GET /api/hub/cameras") - list, 0);
  assert.equal(calls("POST /api/hub/parking") - report, 4);
  assert.equal(calls(`POST /api/hub/cameras/${PARK_CAMERA_ID}/snapshot`) - frames, 4);
});

test("Park-Kameras sicherstellen: stuendlich und sofort bei geaenderter Kiosk-Konfiguration", async () => {
  const ensure = () => calls("POST /api/hub/cameras/ensure");
  const before = ensure();
  // Erstes Sicherstellen bei T0; eine Stunde spaeter wieder.
  advance(T0 + 3_600_000 - TICK_MS - clock);
  await tick();
  assert.equal(ensure() - before, 1);
  await tick();
  assert.equal(ensure() - before, 1);
  // Anderer Port in der Kiosk-Konfiguration: im naechsten Lauf.
  writeKiosk(8080);
  await tick();
  assert.equal(ensure() - before, 2);
  await tick();
  assert.equal(ensure() - before, 2);
});

test("Abgelehnte Meldung: gezaehlt, Fehler und Erholung je einmal im Log, das Tracker-Bild geht trotzdem hoch", async () => {
  const [fails, frames] = [count("report_fail"), calls(`POST /api/hub/cameras/${PARK_CAMERA_ID}/snapshot`)];
  cloud.parkingStatus = 500;
  await tick();
  await tick();
  assert.equal(count("report_fail") - fails, 2);
  assert.deepEqual(logged(/^Parkplatz-Report/), ["Parkplatz-Report fehlgeschlagen: HTTP 500"]);
  assert.equal(calls(`POST /api/hub/cameras/${PARK_CAMERA_ID}/snapshot`) - frames, 2);
  cloud.parkingStatus = 200;
  await tick();
  await tick();
  assert.deepEqual(logged(/^Parkplatz-Report/), [
    "Parkplatz-Report fehlgeschlagen: HTTP 500",
    "Parkplatz-Report: Cloud nimmt die Meldung wieder an",
  ]);
  assert.equal(count("report_fail") - fails, 2);
});

test("Ein Lauf zur Zeit: haengt die Cloud, faellt der naechste Lauf aus und laeuft nicht daneben", async () => {
  const [report, busy] = [calls("POST /api/hub/parking"), count("busy")];
  cloud.holdParking = true;
  advance(TICK_MS);
  const first = parking.reportParking();
  const started = performance.now();
  while (cloud.held.length === 0) {
    if (performance.now() - started > 30_000) throw new Error("gewartet auf die Parkmeldung");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await tick();
  assert.equal(count("busy") - busy, 1);
  assert.equal(calls("POST /api/hub/parking") - report, 1);
  cloud.holdParking = false;
  for (const answer of cloud.held.splice(0)) answer();
  await first;
  // Danach wieder ein normaler Lauf.
  await tick();
  assert.equal(calls("POST /api/hub/parking") - report, 2);
  assert.equal(count("busy") - busy, 1);
});

test("Videostrom ausgefallen: Zaehlung unbekannt statt alter Zahl, kein Bild; danach wieder live", async () => {
  const frames = () => calls(`POST /api/hub/cameras/${PARK_CAMERA_ID}/snapshot`);
  const lastLot = () => cloud.reports.at(-1)!.parking.lots[0];
  // Laufender Strom: Bild geht mit live=1 hoch (Tracker hat eben ein Bild verarbeitet).
  tracker.lastUpdate = clock + TICK_MS;
  await tick();
  assert.equal(lastLot().count, 3);
  assert.equal(lastLot().state, "ok");
  assert.equal(cloud.frameQueries.at(-1), "?source=parking&live=1");

  // Strom bricht ab: Der Tracker meldet den Fehler, sein letztes Bild bleibt stehen.
  const before = frames();
  tracker.lastError = "RTSP-Stream abgebrochen";
  await tick();
  await tick();
  assert.equal(lastLot().count, null);
  assert.equal(lastLot().state, "unbekannt");
  assert.equal(lastLot().lastError, "RTSP-Stream abgebrochen");
  assert.equal(frames() - before, 0, "kein altes Bild als neues");
  assert.equal(count("frame_skip_error"), 2);

  // Strom laeuft wieder, aber das letzte verarbeitete Bild ist alt: Bild ja, „gesehen“ nicht.
  tracker.lastError = null;
  tracker.lastUpdate = clock - 10 * 60_000;
  await tick();
  assert.equal(lastLot().count, 3);
  assert.equal(frames() - before, 1);
  assert.equal(cloud.frameQueries.at(-1), "?source=parking&live=0");
});

test("Tracker nicht erreichbar: Zaehlung unbekannt statt 0, kein Bild", async () => {
  const frames = () => calls(`POST /api/hub/cameras/${PARK_CAMERA_ID}/snapshot`);
  const before = frames();
  tracker.down = true;
  await tick();
  const report = cloud.reports.at(-1)!.parking;
  assert.equal(report.trackerOnline, false);
  assert.equal(report.lots[0].count, null);
  assert.equal(report.lots[0].state, "unbekannt");
  assert.equal(frames() - before, 0);
  tracker.down = false;
});

test("Tor-Automatik: so, wie der Tracker sie meldet; ohne Angabe unbekannt; eine Zeile bei jedem Wechsel", async () => {
  const lastLot = () => cloud.reports.at(-1)!.parking.lots[0];
  const gateLines = () => logged(/^Parkfläche Halle:/);
  // Tracker meldet: zählt nur – seit dem ersten Lauf eine Zeile.
  await tick();
  assert.deepEqual(lastLot().gate, { opens: false, reason: "DoorBird öffnen aus, keine Geräte" });
  assert.deepEqual(gateLines(), ["Parkfläche Halle: zählt nur, Tor-Automatik öffnet nicht (DoorBird öffnen aus, keine Geräte)"]);

  // Älterer Tracker ohne Angabe, in der Kiosk-Konfiguration die alte Einstellung openDoorbird:
  // Er öffnet womöglich danach – der Hub zeigt „unbekannt“, nicht „zählt nur“.
  tracker.gate = undefined;
  writeKiosk(8080, { openDoorbird: true });
  await tick();
  assert.deepEqual(lastLot().gate, { opens: null, reason: "Tracker meldet die Tor-Automatik nicht (älterer Stand)" });
  assert.equal(gateLines().at(-1), "Parkfläche Halle: Tor-Automatik unbekannt (Tracker meldet die Tor-Automatik nicht (älterer Stand))");

  // Tracker meldet: öffnet – der Hub zeigt es an (er schaltet dabei nichts).
  const before = cloudCalls.length;
  tracker.gate = { opens: true, reason: "DoorBird (im Kiosk eingeschaltet)" };
  await tick();
  await tick();
  assert.deepEqual(lastLot().gate, { opens: true, reason: "DoorBird (im Kiosk eingeschaltet)" });
  assert.equal(gateLines().length, 3);
  assert.equal(gateLines()[2], "Parkfläche Halle: Tor-Automatik öffnet bei Fahrzeug in der Fläche (DoorBird (im Kiosk eingeschaltet))");
  assert.deepEqual(
    cloudCalls.slice(before).filter((c) => !c.startsWith("POST /api/hub/parking") && !c.startsWith(`POST /api/hub/cameras/${PARK_CAMERA_ID}/snapshot`)),
    [],
    "nur Meldung und Bild, kein Aufruf zum Oeffnen",
  );

  // Tracker weg: unbekannt, aber keine neue Zeile (sonst zwei je Ausfall).
  tracker.down = true;
  await tick();
  assert.deepEqual(lastLot().gate, { opens: null, reason: "Tracker nicht erreichbar" });
  assert.equal(gateLines().length, 3);
  tracker.down = false;

  tracker.gate = { opens: false, reason: "DoorBird öffnen aus, keine Geräte" };
  writeKiosk(8080);
  await tick();
  assert.equal((lastLot().gate as { opens: boolean | null }).opens, false);
  assert.equal(gateLines().length, 4);
});
