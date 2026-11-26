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
 * Das DoorBird-Modul (doorbird.ts) gegen Attrappen: DoorBirds und eine Cloud
 * auf 127.0.0.1. Die Regeln stehen in hold-rules.ts und camera-poll-rules.ts
 * und haben dort ihre Tests; hier steht, dass doorbird.ts sie anwendet.
 *
 * Der Test laedt eine Kopie von hub/src aus einem eigenen Verzeichnis, ohne
 * .env und mit eigenem .cache. Uhr und Timer stehen und gehen nur, wenn der
 * Test sie stellt (mock.timers); die Anfragen laufen echt. Programme (ping,
 * arp) startet der Hub im Test nicht: Attrappen antworten an ihrer Stelle.
 * Die Tests laufen in dieser Reihenfolge und teilen sich den einen Hub.
 */

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
const MIN = 60_000;
mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: T0 });
/** Wartezeiten, die der Hub plant (setTimeout), in der Reihenfolge der Aufrufe. */
const waits: number[] = [];
/** Dieselben Timer mit ihrem Griff, und welche davon wieder abgeraeumt wurden (clearTimeout). */
const timers: Array<{ ms: number; handle: unknown }> = [];
const clearedTimers = new Set<unknown>();
const mockedSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  waits.push(ms ?? 0);
  const handle = mockedSetTimeout(fn, ms, ...args);
  timers.push({ ms: ms ?? 0, handle });
  return handle;
}) as typeof setTimeout;
const mockedClearTimeout = globalThis.clearTimeout;
globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
  clearedTimers.add(handle);
  return mockedClearTimeout(handle);
}) as typeof clearTimeout;

/* ------------------------------------------ nichts verlaesst den Test */

// Interfaces des Hubs: ein kleines Netz, damit eine Suche zwei Adressen pingt.
mock.method(os, "networkInterfaces", () => ({
  en0: [{ address: "192.0.2.10", netmask: "255.255.255.252", family: "IPv4", mac: "02:00:00:00:00:00", internal: false, cidr: null }],
}));
const noProgram = () => {
  throw new Error("im Test gesperrt");
};
/** ping: Aufrufe; solange `pingHang` gilt, bleiben die Antworten aus. */
const programs = {
  pings: 0,
  pingHang: false,
  heldPings: [] as Array<() => void>,
  /** Ausgabe von `arp -a -n`; null = Aufruf scheitert. */
  arp: null as string | null,
};
const execFileStub = (file: unknown, _args: unknown, ...rest: unknown[]) => {
  const done = rest.find((r) => typeof r === "function") as ((err: Error | null, out?: unknown) => void) | undefined;
  const fail = () => setImmediate(() => done?.(new Error("im Test gesperrt")));
  if (file === "ping") {
    programs.pings++;
    if (programs.pingHang) programs.heldPings.push(fail);
    else fail();
    return;
  }
  if (file === "arp" && programs.arp !== null) {
    const stdout = programs.arp;
    setImmediate(() => done?.(null, { stdout, stderr: "" }));
    return;
  }
  fail();
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
// Gilt damit auch fuer `import { execFile } from "node:child_process"` und
// `import { networkInterfaces } from "node:os"` im Hub.
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
  // Die Dauerverbindung zaehlt nicht: Sie bleibt offen, solange der Monitor laeuft.
  if (url.pathname.endsWith("/monitor.cgi")) return realFetch(input, init);
  pending++;
  try {
    return await realFetch(input, init);
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

/**
 * Antwort einer DoorBird auf monitor.cgi: "hang" = keine Antwort, "stream" =
 * Dauerverbindung steht, "drop" = steht und bricht gleich ab, "reset" =
 * Verbindung ohne Antwort zu (Netzfehler), Zahl = HTTP-Status.
 */
type MonitorMode = "hang" | "stream" | "drop" | "reset" | number;

interface DoorDummy {
  server: http.Server;
  /** Antworten der naechsten Anfragen; die letzte gilt fuer alle weiteren. */
  monitor: MonitorMode[];
  /** Antwort auf open-door.cgi: HTTP-Status oder "reset" (Verbindung mitten in der Anfrage zu). */
  openStatus: number | "reset";
  opens: number;
  /** Antwort auf image.cgi (HTTP-Status) und Zahl der Anfragen. */
  imageStatus: number;
  images: number;
  monitorRequests: number;
  /** Benutzer:Passwort je Anfrage an monitor.cgi. */
  auth: string[];
  open: Set<http.ServerResponse>;
}

function doorDummy(): DoorDummy {
  const door: DoorDummy = {
    server: http.createServer(),
    monitor: ["hang"],
    openStatus: 200,
    opens: 0,
    imageStatus: 200,
    images: 0,
    monitorRequests: 0,
    auth: [],
    open: new Set(),
  };
  door.server.on("request", (req, res) => {
    res.setHeader("Connection", "close");
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/bha-api/open-door.cgi") {
      door.opens++;
      if (door.openStatus === "reset") return void req.socket.destroy();
      res.writeHead(door.openStatus).end();
      return;
    }
    if (url.pathname === "/bha-api/image.cgi") {
      door.images++;
      if (door.imageStatus !== 200) return void res.writeHead(door.imageStatus).end();
      res.writeHead(200, { "Content-Type": "image/jpeg" }).end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return;
    }
    if (url.pathname !== "/bha-api/monitor.cgi") return void res.writeHead(404).end();
    door.monitorRequests++;
    door.auth.push(Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString());
    const mode = door.monitor.length > 1 ? door.monitor.shift()! : door.monitor[0];
    if (mode === "reset") return void req.socket.destroy();
    if (typeof mode === "number") return void res.writeHead(mode).end();
    door.open.add(res);
    res.on("close", () => door.open.delete(res));
    if (mode === "hang") return;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("doorbell:L\n");
    if (mode === "drop") setImmediate(() => res.destroy());
  });
  return door;
}

/** Die stehende Dauerverbindung abbrechen (wie ein Neustart der DoorBird). */
function dropStream(door: DoorDummy): void {
  for (const res of door.open) res.destroy();
}

const door = doorDummy();
const door2 = doorDummy();
door2.monitor = ["stream"];
/** Dritte DoorBird fuer abgelehnte Zugangsdaten. */
const door3 = doorDummy();

/** Antwort der Cloud auf eine Impuls-Meldung. */
type HoldAnswer = { status: number; body?: unknown };
const cloud = {
  server: http.createServer(),
  holdAnswer: { status: 200, body: { ok: true } } as HoldAnswer,
  /** Meldungen zurueckhalten, bis der Test sie freigibt. */
  holdBack: false,
  held: [] as Array<() => void>,
  reports: [] as Array<{ ok: boolean }>,
  /** Meldungen einer neuen Adresse (/api/hub/cameras/[id]/network). */
  network: [] as Array<{ id: number; body: unknown }>,
  /** Befunde an die Cloud (/api/hub/alerts). */
  alerts: [] as Array<{ source: string; alerts: Array<{ key: string; title: string }> }>,
};
cloud.server.on("request", (req, res) => {
  res.setHeader("Connection", "close");
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    if (/^\/api\/hub\/cameras\/\d+\/door-hold$/.test(url.pathname)) {
      cloud.reports.push(JSON.parse(body) as { ok: boolean });
      const answer = cloud.holdAnswer;
      const send = () => {
        res.writeHead(answer.status, { "Content-Type": "application/json" });
        res.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
      };
      if (cloud.holdBack) cloud.held.push(send);
      else send();
      return;
    }
    const network = url.pathname.match(/^\/api\/hub\/cameras\/(\d+)\/network$/);
    if (network) cloud.network.push({ id: Number(network[1]), body: JSON.parse(body) });
    if (url.pathname === "/api/hub/alerts") cloud.alerts.push(JSON.parse(body) as (typeof cloud.alerts)[number]);
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
});

/* ----------------------------------------------------------- der Hub */

let hub: typeof import("./doorbird.js");

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(what: string, done: () => boolean): Promise<void> {
  const started = performance.now();
  while (!done()) {
    if (performance.now() - started > 20_000) throw new Error(`gewartet auf: ${what}`);
    await turn();
  }
}
/** Warten, bis keine Anfrage des Hubs mehr unterwegs ist, bis auf `open` zurueckgehaltene Meldungen. */
async function quiet(open = 0): Promise<void> {
  let calm = 0;
  await until(`${pending} offene Anfragen`, () => {
    calm = pending === open && cloud.held.length === open ? calm + 1 : 0;
    return calm > 5;
  });
}
/** Die Uhr vorstellen; was dann faellig ist, laeuft. */
async function advance(ms: number, open = 0): Promise<void> {
  mock.timers.tick(ms);
  await quiet(open);
}
function release(): void {
  cloud.holdBack = false;
  for (const send of cloud.held.splice(0)) send();
}
/** Warten, bis der Hub eine Wartezeit von `ms` plant (nach dem Stand `from` von `waits`). */
async function scheduled(ms: number, from: number): Promise<void> {
  await until(`Wartezeit ${ms} ms`, () => waits.slice(from).includes(ms));
  await quiet();
}

const ID = 11;
const ID2 = 12;
const MAC2 = "02:00:5E:10:00:01";
const port = (server: http.Server) => (server.address() as AddressInfo).port;
const config = () => ({
  id: ID,
  name: "Tor",
  kind: "DOORBIRD",
  host: "127.0.0.1",
  macAddress: null,
  httpPort: port(door.server),
  https: false,
  username: "attrappe",
  password: "attrappe",
  channel: 0,
  doorHoldUntil: null,
});
/** Zweite DoorBird fuer die Dauerverbindung; mit MAC, damit der Hub sie suchen kann. */
const config2 = (over: Record<string, unknown> = {}) => ({
  ...config(),
  id: ID2,
  name: "Pforte",
  macAddress: MAC2,
  httpPort: port(door2.server),
  ...over,
});
const iso = (ms: number) => new Date(ms).toISOString();
const holdState = () => hub.listDoorbirdStatus().find((d) => d.id === ID)?.hold ?? null;

function claimSandbox(): string {
  for (let n = 0; ; n++) {
    const dir = path.join(os.tmpdir(), `emp-hub-doorbird-${n}`);
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

const servers = [door.server, door2.server, door3.server, cloud.server];
let hubDir = "";
/** Zweite Adresse der DoorBird 2 (127.0.0.2, gleicher Port), falls der Rechner sie hat. */
let door2b: DoorDummy | null = null;

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

  await Promise.all(servers.map((s) => new Promise<void>((r) => s.listen(0, "127.0.0.1", r))));
  for (const s of servers) dummies.add(`http://127.0.0.1:${port(s)}`);
  const second = doorDummy();
  second.monitor = ["stream"];
  const bound = await new Promise<boolean>((resolve) => {
    second.server.once("error", () => resolve(false));
    second.server.listen(port(door2.server), "127.0.0.2", () => resolve(true));
  });
  if (bound) {
    door2b = second;
    servers.push(second.server);
    dummies.add(`http://127.0.0.2:${port(door2.server)}`);
  }
  for (const key of Object.keys(process.env)) if (/^(HUB|FACE)_/.test(key)) delete process.env[key];
  process.env.HUB_API_URL = `http://127.0.0.1:${port(cloud.server)}`;
  process.env.HUB_API_TOKEN = "attrappe";
  process.env.HUB_IMPROVE_LOG = "0";

  hub = await import(pathToFileURL(path.join(hubDir, "src", "doorbird.ts")).href);
  hub.syncDoorbirds([config()]);
  await until("Monitor-Anfrage", () => door.monitorRequests > 0);
});

after(async () => {
  hub.syncDoorbirds([]);
  for (const d of [door, door2, door3, door2b]) if (d) dropStream(d);
  for (const ping of programs.heldPings.splice(0)) ping();
  release();
  await quiet();
  mock.timers.reset();
  // Offene Verbindungen (auch die abgebrochene Dauerverbindung) schliessen,
  // sonst wartet der Prozess auf ihr Zeitlimit.
  for (const s of servers) {
    s.closeAllConnections();
    s.unref();
  }
  assert.deepEqual(foreign, [], "der Hub spricht im Test nur mit den Attrappen");
});

/** Offenhalten per Auftrag starten, wie tasks.ts es tut, und den ersten Impuls abwarten. */
async function startHold(minutes: number): Promise<number> {
  const untilMs = Date.now() + minutes * MIN;
  const r = await hub.setDoorbirdHold(ID, iso(untilMs), { source: "task" });
  assert.equal(r.ok, true);
  await quiet();
  return untilMs;
}

async function stopHold(): Promise<void> {
  await hub.setDoorbirdHold(ID, null, { source: "task" });
  await quiet();
}

test("Offen halten: kennt die Cloud kein Offenhalten mehr, endet es nach dem Impuls", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true, until: null } };
  const opens = door.opens;
  await startHold(30);
  assert.equal(door.opens - opens, 1);
  assert.equal(holdState(), null);
  assert.equal(logged(/Offen halten in der Cloud beendet/).length, 1);
  // Kein weiterer Impuls im Takt.
  await advance(50_000);
  await advance(50_000);
  assert.equal(door.opens - opens, 1);
});

test("Offen halten: einen anderen Endzeitpunkt der Cloud uebernimmt der Hub", async () => {
  const later = Date.now() + 2 * 60 * MIN;
  cloud.holdAnswer = { status: 200, body: { ok: true, until: iso(later) } };
  await startHold(30);
  assert.equal(holdState()?.until, iso(later));
  assert.equal(logged(/Offen halten jetzt bis .* \(Zielzustand der Cloud\)/).length, 1);
  // Gleicher Zielzustand bei den naechsten Impulsen: nichts Neues im Log.
  await advance(50_000);
  assert.equal(logged(/Zielzustand der Cloud/).length, 1);
  await stopHold();
});

test("Offen halten: ohne Feld (aeltere Cloud) oder ohne Antwort bis zum lokalen Ende, weder kuerzer noch laenger", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  const opens = door.opens;
  const end = await startHold(2);
  assert.equal(holdState()?.until, iso(end));
  cloud.holdAnswer = { status: 503 };
  await advance(50_000);
  assert.equal(holdState()?.until, iso(end));
  cloud.holdAnswer = { status: 200, body: "kein JSON-Objekt" };
  await advance(50_000);
  assert.equal(holdState()?.until, iso(end));
  assert.equal(door.opens - opens, 3);
  // Der naechste Takt liegt nach dem Ende: Schluss ohne Impuls.
  await advance(50_000);
  assert.equal(holdState(), null);
  assert.equal(door.opens - opens, 3);
  assert.equal(logged(/Offen halten abgelaufen/).length, 1);
});

test("Offen halten: eine Antwort aus der Zeit vor einer Verlaengerung kuerzt sie nicht", async () => {
  const end = await startHold(30);
  // Die Cloud kennt noch das alte Ende; ihre Antwort kommt erst nach der Verlaengerung an.
  cloud.holdAnswer = { status: 200, body: { ok: true, until: iso(end) } };
  cloud.holdBack = true;
  await advance(50_000, 1);
  const longer = Date.now() + 90 * MIN;
  await hub.setDoorbirdHold(ID, iso(longer), { source: "task" });
  release();
  await quiet();
  assert.equal(holdState()?.until, iso(longer));
  await stopHold();
});

test("Offen halten: eine spaete null-Antwort beendet ein inzwischen neu gestartetes Offenhalten nicht", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  await startHold(30);
  cloud.holdAnswer = { status: 200, body: { ok: true, until: null } };
  cloud.holdBack = true;
  await advance(50_000, 1);
  // Beendet und neu gestartet, bevor die Antwort ankommt.
  await hub.setDoorbirdHold(ID, null, { source: "task" });
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  const fresh = Date.now() + 20 * MIN;
  await hub.setDoorbirdHold(ID, iso(fresh), { source: "task" });
  await quiet(2);
  // Die zurueckgehaltene null-Antwort kommt jetzt an (die Meldung des neuen
  // Impulses ebenfalls, mit dem Zielzustand von jetzt).
  release();
  await quiet();
  assert.equal(holdState()?.until, iso(fresh));
  await stopHold();
});

test("Offen halten: ein gescheiterter Impuls wird nach 3, 8 und 20 s wiederholt, danach im normalen Takt", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  door.openStatus = 503;
  const opens = door.opens;
  const at = () => door.opens - opens;
  await startHold(30);
  assert.equal(at(), 1);
  assert.equal(logged(/Offenhalte-Impuls fehlgeschlagen: open-door.cgi HTTP 503 – neuer Versuch in 3 s/).length, 1);
  await advance(2_999);
  assert.equal(at(), 1);
  await advance(1);
  assert.equal(at(), 2);
  await advance(8_000);
  assert.equal(at(), 3);
  await advance(20_000);
  assert.equal(at(), 4);
  // 31 s nach dem ersten Impuls: bis zum Takt bei 50 s kein weiterer Versuch.
  await advance(18_999);
  assert.equal(at(), 4);
  await advance(1);
  assert.equal(at(), 5);
  // Auch der Takt scheitert: keine neue Reihe von Wiederholungen.
  await advance(49_999);
  assert.equal(at(), 5);
  // Gelingt ein Impuls, beginnt die Reihe beim naechsten Fehlschlag von vorn.
  door.openStatus = 200;
  await advance(1);
  assert.equal(at(), 6);
  door.openStatus = 503;
  await advance(50_000);
  assert.equal(at(), 7);
  await advance(3_000);
  assert.equal(at(), 8);
  door.openStatus = 200;
  await stopHold();
});

test("Offen halten: bricht die Verbindung mitten im Impuls ab, kommt der naechste erst im Takt", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  door.openStatus = "reset";
  const opens = door.opens;
  const at = () => door.opens - opens;
  const open = /Offenhalte-Impuls fehlgeschlagen: .* – ob er angekommen ist, ist offen; nächster Impuls im normalen Takt$/;
  const lines = logged(open).length;
  await startHold(30);
  assert.equal(at(), 1);
  assert.equal(logged(open).length, lines + 1);
  // Ob das Relais schon geschaltet hat, ist offen: keine Wiederholung nach 3, 8 oder 20 s.
  await advance(3_000);
  await advance(8_000);
  await advance(20_000);
  assert.equal(at(), 1, "keine schnelle Wiederholung");
  door.openStatus = 200;
  await advance(50_000 - 31_000);
  assert.equal(at(), 2, "der naechste Impuls im Takt");
  await stopHold();
});

test("Offen halten: gelingt eine Wiederholung, beginnt der Takt ab ihr neu", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  door.openStatus = 200;
  const opens = door.opens;
  const at = () => door.opens - opens;
  await startHold(30);
  assert.equal(at(), 1);
  // Der Impuls im Takt bei 50 s scheitert, die Wiederholungen nach 3 und 8 s auch.
  door.openStatus = 503;
  await advance(50_000);
  await advance(3_000);
  await advance(8_000);
  assert.equal(at(), 4);
  // Die nach 20 s (bei 81 s) gelingt.
  door.openStatus = 200;
  await advance(20_000);
  assert.equal(at(), 5);
  // Der naechste Impuls kommt 50 s danach, nicht schon bei 100 s.
  await advance(49_999);
  assert.equal(at(), 5);
  await advance(1);
  assert.equal(at(), 6);
  await advance(50_000);
  assert.equal(at(), 7);
  await stopHold();
});

test("Offen halten: nach dem Ende findet kein wiederholter Impuls statt", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  door.openStatus = 503;
  const opens = door.opens;
  await startHold(30);
  assert.equal(door.opens - opens, 1);
  await stopHold();
  await advance(3_000);
  await advance(8_000);
  await advance(50_000);
  assert.equal(door.opens - opens, 1);
  // Auch nicht, wenn das Ende per Antwort der Cloud kommt.
  await startHold(30);
  assert.equal(door.opens - opens, 2);
  cloud.holdAnswer = { status: 200, body: { ok: true, until: null } };
  await advance(3_000);
  assert.equal(door.opens - opens, 3);
  assert.equal(holdState(), null);
  await advance(8_000);
  await advance(50_000);
  assert.equal(door.opens - opens, 3);
  door.openStatus = 200;
});

test("Offen halten: eine Wiederholung aus einem beendeten Offenhalten pulst nicht fuer ein neues", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  door.openStatus = 503;
  const opens = door.opens;
  await startHold(30);
  assert.equal(door.opens - opens, 1);
  assert.equal(logged(/Offenhalte-Impuls fehlgeschlagen: .* – neuer Versuch in 3 s/).length > 0, true);
  await stopHold();
  // Sofort ein neues Offenhalten; sein erster Impuls gelingt.
  door.openStatus = 200;
  await startHold(30);
  assert.equal(door.opens - opens, 2);
  // Die Wiederholung des ersten waere jetzt faellig: kein Impuls.
  await advance(3_000);
  await advance(8_000);
  await advance(20_000);
  assert.equal(door.opens - opens, 2);
  // Das neue haelt seinen Takt.
  await advance(50_000 - 31_000);
  assert.equal(door.opens - opens, 3);
  await stopHold();
});

test("Offen halten: das Ende raeumt eine geplante Wiederholung ab", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  door.openStatus = 503;
  const mark = timers.length;
  await startHold(30);
  const retries = timers.slice(mark).filter((t) => t.ms === 3_000);
  assert.equal(retries.length, 1, "eine Wiederholung nach 3 s geplant");
  assert.equal(clearedTimers.has(retries[0].handle), false);
  await stopHold();
  assert.equal(clearedTimers.has(retries[0].handle), true, "Wiederholung beim Ende abgeraeumt");
  door.openStatus = 200;
});

test("Offen halten aus der Kamera-Liste: nur mit einem Ende in der Zukunft", async () => {
  cloud.holdAnswer = { status: 200, body: { ok: true } };
  const opens = door.opens;
  // Vorbei, genau jetzt oder nicht lesbar: kein Impuls.
  for (const doorHoldUntil of [iso(Date.now() - MIN), iso(Date.now()), "morgen"]) {
    hub.syncDoorbirds([{ ...config(), doorHoldUntil }]);
    await quiet();
    assert.equal(door.opens - opens, 0, doorHoldUntil);
    assert.equal(holdState(), null);
  }
  // In der Zukunft: Der Hub nimmt es auf (Neustart waehrend eines Offenhaltens).
  const end = Date.now() + 10 * MIN;
  hub.syncDoorbirds([{ ...config(), doorHoldUntil: iso(end) }]);
  await quiet();
  assert.equal(door.opens - opens, 1);
  assert.equal(holdState()?.until, iso(end));
  await stopHold();
  hub.syncDoorbirds([config()]);
  await quiet();
  assert.equal(door.opens - opens, 1);
});

/* ------------------------------------------------- Dauerverbindung */

/** DoorBird 2 anmelden und warten, bis ihre Dauerverbindung steht. */
async function connectDoor2(): Promise<void> {
  const before = door2.monitorRequests;
  hub.syncDoorbirds([config(), config2()]);
  await until("Dauerverbindung DoorBird 2", () => door2.monitorRequests > before && door2.open.size === 1);
  await quiet();
}

test("Dauerverbindung: nach einem Abbruch verbindet der Hub nach 3 s neu, ohne Suche, und nennt die Dauer der Luecke", async () => {
  await connectDoor2();
  const requests = door2.monitorRequests;
  const pings = programs.pings;
  door2.monitor = ["stream"];
  const mark = waits.length;
  dropStream(door2);
  await scheduled(3_000, mark);
  assert.deepEqual(logged(/^DoorBird Pforte: Monitor getrennt/), ["DoorBird Pforte: Monitor getrennt (terminated) – Reconnect …"]);
  await advance(2_999);
  assert.equal(door2.monitorRequests, requests);
  await advance(1);
  await until("neue Verbindung", () => door2.open.size === 1);
  assert.equal(door2.monitorRequests, requests + 1);
  await until("Zeile wieder erreichbar", () => logged(/^DoorBird Pforte: wieder erreichbar/).length === 1);
  assert.deepEqual(logged(/^DoorBird Pforte: wieder erreichbar/), ["DoorBird Pforte: wieder erreichbar nach 3.0 s"]);
  assert.equal(programs.pings, pings, "keine Suche nach neuer Adresse");
});

test("Dauerverbindung: erst nach zwei Netzfehlern in Folge sucht der Hub, im Hintergrund; das Neuverbinden wartet nicht darauf", async () => {
  const requests = door2.monitorRequests;
  const pings = programs.pings;
  // Die Suche haengt: Die Pings antworten nicht, bis der Test sie freigibt.
  programs.pingHang = true;
  door2.monitor = ["reset", "reset", "reset", "stream"];
  let mark = waits.length;
  dropStream(door2);
  await scheduled(3_000, mark);
  mark = waits.length;
  await advance(3_000);
  // Erster Versuch scheitert am Netz: noch keine Suche.
  await scheduled(6_000, mark);
  assert.equal(door2.monitorRequests, requests + 1);
  assert.equal(programs.pings, pings);
  mark = waits.length;
  await advance(6_000);
  // Zweiter Netzfehler: Suche beginnt (Ping-Sweep), der naechste Versuch ist schon geplant.
  await scheduled(12_000, mark);
  assert.equal(door2.monitorRequests, requests + 2);
  await until("Ping-Sweep", () => programs.pings > pings);
  mark = waits.length;
  await advance(12_000);
  await scheduled(24_000, mark);
  assert.equal(door2.monitorRequests, requests + 3);
  // Eine zweite Suche beginnt nicht, solange eine laeuft oder keine Minute vergangen ist.
  const sweepPings = programs.pings;
  await advance(24_000);
  await until("neue Verbindung", () => door2.open.size === 1);
  assert.equal(door2.monitorRequests, requests + 4);
  assert.equal(programs.pings, sweepPings);
  await until("Zeile wieder erreichbar", () => logged(/^DoorBird Pforte: wieder erreichbar/).length === 2);
  assert.equal(logged(/^DoorBird Pforte: wieder erreichbar/)[1], "DoorBird Pforte: wieder erreichbar nach 45.0 s");
  programs.pingHang = false;
  for (const ping of programs.heldPings.splice(0)) ping();
  await quiet();
  assert.deepEqual(logged(/per MAC unter neuer IP/), []);
});

test("Dauerverbindung: eine HTTP-Antwort kommt von der DoorBird unter ihrer Adresse, gesucht wird nicht", async () => {
  const pings = programs.pings;
  door2.monitor = [503, 503, 503, "stream"];
  let mark = waits.length;
  dropStream(door2);
  await scheduled(3_000, mark);
  // Je Versuch eine HTTP-Antwort; die Wartezeit verdoppelt sich wie bisher.
  for (const [wait, next] of [
    [3_000, 6_000],
    [6_000, 12_000],
    [12_000, 24_000],
  ]) {
    mark = waits.length;
    await advance(wait);
    await scheduled(next, mark);
  }
  await advance(24_000);
  await until("neue Verbindung", () => door2.open.size === 1);
  assert.equal(programs.pings, pings);
});

test("Dauerverbindung: findet die Suche die DoorBird unter neuer Adresse, verbindet der Hub sofort dort", async (t) => {
  if (!door2b) return t.skip("127.0.0.2 ist auf diesem Rechner nicht eingerichtet");
  // Die ARP-Tabelle kennt die MAC unter 127.0.0.2.
  programs.arp = "? (127.0.0.2) at 2:0:5e:10:0:1 on lo0 ifscope [ethernet]\n";
  door2.monitor = ["reset"];
  let mark = waits.length;
  dropStream(door2);
  await scheduled(3_000, mark);
  mark = waits.length;
  await advance(3_000);
  await scheduled(6_000, mark);
  mark = waits.length;
  await advance(6_000);
  // Zweiter Netzfehler: Die Suche findet die MAC; die geplanten 12 s wartet der Hub nicht ab.
  await until("Verbindung unter neuer Adresse", () => door2b!.open.size === 1);
  await quiet();
  assert.equal(door2b.monitorRequests, 1);
  assert.deepEqual(logged(/per MAC unter neuer IP/), ["DoorBird Pforte: per MAC unter neuer IP gefunden (127.0.0.1 → 127.0.0.2)"]);
  assert.deepEqual(cloud.network.at(-1), { id: ID2, body: { host: "127.0.0.2" } });
  assert.equal(hub.listDoorbirdStatus().find((d) => d.id === ID2)?.host, "127.0.0.2");
  programs.arp = null;
  // Zurueck auf die erste Adresse, wie die Cloud sie wieder nennt.
  door2.monitor = ["stream"];
  hub.syncDoorbirds([config(), config2()]);
  await until("Dauerverbindung wieder unter 127.0.0.1", () => door2.open.size === 1);
  await quiet();
});

/** ARP-Tabelle: unter 127.0.0.1 ein anderes Geraet, die DoorBird 2 (MAC2) unter 127.0.0.2. */
const ARP_OTHER_AT_OLD =
  "? (127.0.0.1) at 2:0:0:aa:bb:cc on lo0 ifscope [ethernet]\n? (127.0.0.2) at 2:0:5e:10:0:1 on lo0 ifscope [ethernet]\n";
const latchedPforte = () =>
  logged(/^DoorBird Pforte: Zugangsdaten/).length +
  cloud.alerts.filter((a) => a.alerts.some((x) => x.key.endsWith(`doorbird-${ID2}`))).length;

test("Dauerverbindung: ein HTTP-Fehler dazwischen beendet die Folge der Netzfehler, gesucht wird nicht", async (t) => {
  if (!door2b) return t.skip("127.0.0.2 ist auf diesem Rechner nicht eingerichtet");
  // Die letzte Suche liegt mehr als eine Minute zurueck; eine Suche faende die DoorBird unter 127.0.0.2.
  await advance(60_000);
  programs.arp = "? (127.0.0.2) at 2:0:5e:10:0:1 on lo0 ifscope [ethernet]\n";
  const opened = door2b.monitorRequests;
  door2.monitor = ["reset", 503, "reset", "stream"];
  let mark = waits.length;
  dropStream(door2);
  await scheduled(3_000, mark);
  for (const [wait, next] of [
    [3_000, 6_000], // Netzfehler
    [6_000, 12_000], // HTTP 503 von der DoorBird
    [12_000, 24_000], // Netzfehler: erst einer in Folge
  ]) {
    mark = waits.length;
    await advance(wait);
    await scheduled(next, mark);
  }
  await advance(24_000);
  await until("neue Verbindung", () => door2.open.size === 1);
  assert.equal(door2b.monitorRequests, opened, "keine Suche, kein Wechsel der Adresse");
  assert.deepEqual(logged(/per MAC unter neuer IP/), ["DoorBird Pforte: per MAC unter neuer IP gefunden (127.0.0.1 → 127.0.0.2)"]);
  programs.arp = null;
});

test("Dauerverbindung: antwortet unter der alten Adresse ein anderes Geraet (401 oder 404), findet der Hub die DoorBird, und die Sperre greift nicht", async (t) => {
  if (!door2b) return t.skip("127.0.0.2 ist auf diesem Rechner nicht eingerichtet");
  const newAddr: DoorDummy = door2b;
  // Oeffnen: zwei Ablehnungen des anderen Geraets sperren nicht.
  programs.arp = ARP_OTHER_AT_OLD;
  door2.openStatus = 401;
  const opens = door2.opens;
  for (let i = 0; i < 3; i++) {
    const r = await hub.openDoorbirdDoor(ID2, 1, { quiet: true });
    assert.deepEqual(r, { ok: false, error: "open-door.cgi HTTP 401 von einem anderen Gerät unter 127.0.0.1", retrySafe: true });
  }
  assert.equal(door2.opens, opens + 3, "jeder Versuch erreicht die Adresse, keine Sperre");
  door2.openStatus = 200;

  for (const status of [401, 404]) {
    // Die letzte Suche liegt mehr als eine Minute zurueck.
    await advance(60_000);
    programs.arp = ARP_OTHER_AT_OLD;
    const found = logged(/per MAC unter neuer IP/).length;
    const latched = latchedPforte();
    const atNew = newAddr.monitorRequests;
    door2.monitor = [status];
    let mark = waits.length;
    dropStream(door2);
    await scheduled(3_000, mark);
    mark = waits.length;
    await advance(3_000);
    // Erste Antwort des anderen Geraets: wie ein Netzfehler, noch keine Suche.
    await scheduled(6_000, mark);
    assert.equal(newAddr.monitorRequests, atNew);
    await advance(6_000);
    // Zweite: Die Suche findet die MAC unter 127.0.0.2, der Hub verbindet sofort dort.
    await until(`Verbindung unter neuer Adresse (${status})`, () => newAddr.open.size === 1);
    await quiet();
    assert.equal(logged(/per MAC unter neuer IP/).length, found + 1);
    assert.equal(hub.listDoorbirdStatus().find((d) => d.id === ID2)?.host, "127.0.0.2");
    assert.equal(latchedPforte(), latched, "keine Sperre und keine Meldung „Zugangsdaten abgelehnt“");
    const opensNew = newAddr.opens;
    assert.equal((await hub.openDoorbirdDoor(ID2, 1, { quiet: true })).ok, true);
    assert.equal(newAddr.opens, opensNew + 1);
    // Zurueck auf die erste Adresse, wie die Cloud sie wieder nennt.
    programs.arp = null;
    door2.monitor = ["stream"];
    hub.syncDoorbirds([config(), config2()]);
    await until("Dauerverbindung wieder unter 127.0.0.1", () => door2.open.size === 1 && newAddr.open.size === 0);
    await quiet();
  }
  if (fs.existsSync(latchFile())) assert.equal(fs.readFileSync(latchFile(), "utf8").includes(`doorbird:${ID2}`), false);
});

/* ------------------------------------------------- Zugangsdaten abgelehnt */

const ID3 = 13;
const config3 = (over: Record<string, unknown> = {}) => ({
  ...config(),
  id: ID3,
  name: "Lieferzufahrt",
  macAddress: "02:00:5E:10:00:03",
  httpPort: port(door3.server),
  ...over,
});
const latchFile = () => path.join(hubDir, ".cache", "auth-latch.json");
const DAY = 24 * 60 * MIN;
/** ARP-Tabelle: unter 127.0.0.1 die MAC der Lieferzufahrt bzw. die eines anderen Geraets. */
const ARP_DOOR3 = "? (127.0.0.1) at 2:0:5e:10:0:3 on lo0 ifscope [ethernet]\n";
const ARP_OTHER = "? (127.0.0.1) at 2:0:0:aa:bb:cc on lo0 ifscope [ethernet]\n";
/** Zeitpunkt der zweiten Ablehnung (Beginn der Sperre). */
let lockedAt = 0;

test("Zugangsdaten abgelehnt: nach zwei 401 keine Verbindung, kein Oeffnen und keine Suche mehr; Meldung an die Cloud", async () => {
  const pings = programs.pings;
  const alertsBefore = cloud.alerts.length;
  door3.monitor = [401];
  // Die ARP-Tabelle ist nicht lesbar: Ob die Ablehnung von der DoorBird kommt,
  // ist offen (unter der alten Adresse kann ein anderes Geraet antworten).
  programs.arp = null;
  let mark = waits.length;
  hub.syncDoorbirds([config(), config3()]);
  await until("erste Anfrage", () => door3.monitorRequests === 1);
  await scheduled(3_000, mark);
  mark = waits.length;
  await advance(3_000);
  await until("zweite Anfrage", () => door3.monitorRequests === 2);
  await scheduled(6_000, mark);
  assert.deepEqual(logged(/^DoorBird Lieferzufahrt: Zugangsdaten abgelehnt/), [], "ohne lesbare ARP-Tabelle keine Sperre");
  // Wieder lesbar, die MAC unter der Adresse ist die der DoorBird: Zwei Ablehnungen sperren.
  programs.arp = ARP_DOOR3;
  mark = waits.length;
  await advance(6_000);
  await until("dritte Anfrage", () => door3.monitorRequests === 3);
  await scheduled(12_000, mark);
  await advance(12_000);
  await until("vierte Anfrage", () => door3.monitorRequests === 4);
  lockedAt = Date.now();
  await until("Zeile zur Sperre", () => logged(/^DoorBird Lieferzufahrt: Zugangsdaten abgelehnt/).length === 1);
  assert.deepEqual(logged(/^DoorBird Lieferzufahrt: Zugangsdaten abgelehnt/), [
    "DoorBird Lieferzufahrt: Zugangsdaten abgelehnt (HTTP 401, zweimal in Folge) – keine weiteren Versuche, " +
      "bis sie in der Cloud geändert werden; ein einzelner Versuch alle 24 h",
  ]);
  await until("Meldung an die Cloud", () => cloud.alerts.slice(alertsBefore).some((a) => a.alerts.length === 1));
  const sent = cloud.alerts.at(-1)!;
  assert.match(sent.source, /^zugang/);
  assert.deepEqual(
    sent.alerts.map((a) => a.title),
    ["DoorBird Lieferzufahrt: Zugangsdaten abgelehnt"]
  );
  // Weder neu verbinden noch eine neue Adresse suchen.
  for (const ms of [6_000, 60_000, 60 * MIN, 12 * 60 * MIN]) await advance(ms);
  assert.equal(door3.monitorRequests, 4);
  assert.equal(programs.pings, pings);
  // Oeffnen scheitert sofort, ohne Anfrage an die DoorBird.
  const opens = door3.opens;
  const r = await hub.openDoorbirdDoor(ID3);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /^Zugangsdaten abgelehnt/);
  assert.equal(door3.opens, opens);
  // Der Zustand steht auf der Platte, nur fuer den Hub-Benutzer lesbar und ohne Zugangsdaten.
  await until("Datei der Sperre", () => fs.existsSync(latchFile()) && fs.readFileSync(latchFile(), "utf8").includes(`doorbird:${ID3}`));
  assert.equal(fs.statSync(latchFile()).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(latchFile(), "utf8").includes("attrappe"), false);
  assert.deepEqual(logged(/attrappe/), []);
});

test("Zugangsdaten abgelehnt: ein einzelner Versuch in 24 Stunden; neue Zugangsdaten in der Cloud loesen die Sperre", async () => {
  await advance(lockedAt + DAY - Date.now() - 1);
  assert.equal(door3.monitorRequests, 4);
  // Der einzelne Versuch ist faellig, die Dauerverbindung hat ihn noch nicht
  // genommen: Oeffnen geht trotzdem nicht hinaus und nimmt ihn ihr nicht weg.
  mock.timers.setTime(lockedAt + DAY);
  const opensLocked = door3.opens;
  const blocked = await hub.openDoorbirdDoor(ID3, 1, { quiet: true });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error ?? "", /^Zugangsdaten abgelehnt/);
  assert.equal(door3.opens, opensLocked);
  await advance(0);
  await until("einzelner Versuch", () => door3.monitorRequests === 5);
  await quiet();
  // Wieder abgelehnt: weiter gesperrt, ohne neue Zeile und ohne Suche.
  const pings = programs.pings;
  await advance(6_000);
  await advance(60 * MIN);
  assert.equal(door3.monitorRequests, 5);
  assert.equal(programs.pings, pings);
  assert.equal(logged(/^DoorBird Lieferzufahrt: Zugangsdaten abgelehnt/).length, 1);

  // Beim naechsten einzelnen Versuch antwortet unter der Adresse ein anderes
  // Geraet: Die DoorBird kann eine neue Adresse haben, der Hub sucht sofort.
  programs.arp = ARP_OTHER;
  await advance(lockedAt + 2 * DAY - Date.now());
  await until("zweiter einzelner Versuch", () => door3.monitorRequests === 6);
  await until("Suche", () => programs.pings > pings);
  await quiet();
  assert.equal(logged(/^DoorBird Lieferzufahrt: Zugangsdaten abgelehnt/).length, 1, "die Sperre bleibt, bis die DoorBird gefunden ist");
  // Die ARP-Tabelle nennt wieder die DoorBird (der gemerkte Stand gilt 15 s).
  programs.arp = ARP_DOOR3;
  await advance(20_000);

  const alertsBefore = cloud.alerts.length;
  door3.monitor = ["stream"];
  hub.syncDoorbirds([config(), config3({ password: "neu" })]);
  await until("Verbindung mit den neuen Zugangsdaten", () => door3.open.size === 1);
  assert.equal(door3.monitorRequests, 7);
  assert.equal(door3.auth.at(-1), "attrappe:neu");
  assert.deepEqual(logged(/^DoorBird Lieferzufahrt: Sperre/), [
    "DoorBird Lieferzufahrt: Sperre der Zugangsdaten aufgehoben (Zugangsdaten oder Adresse in der Cloud geändert)",
  ]);
  await until("Entwarnung an die Cloud", () => cloud.alerts.slice(alertsBefore).some((a) => a.alerts.length === 0));
  const opens = door3.opens;
  assert.equal((await hub.openDoorbirdDoor(ID3, 1, { quiet: true })).ok, true);
  assert.equal(door3.opens, opens + 1);
});

test("Zugangsdaten abgelehnt: eine Ablehnung beim Oeffnen sperrt nicht; Relais 1 und die Dauerverbindung bleiben", async () => {
  // Die Ablehnung kommt von der DoorBird selbst, etwa weil die Berechtigung fuer Relais 2 fehlt.
  programs.arp = ARP_DOOR3;
  door3.openStatus = 401;
  const opens = door3.opens;
  for (let i = 0; i < 3; i++) {
    const r = await hub.openDoorbirdDoor(ID3, 2, { quiet: true });
    assert.equal(r.ok, false);
    assert.equal(r.error, "open-door.cgi HTTP 401");
  }
  assert.equal(door3.opens, opens + 3, "jeder Versuch erreicht die DoorBird");
  door3.openStatus = 200;
  // Ebenso das Bild (Berechtigung fuer das Live-Bild fehlt).
  const images = door3.images;
  door3.imageStatus = 401;
  for (let i = 0; i < 2; i++) await assert.rejects(hub.captureDoorbirdSnapshot(ID3), /image\.cgi HTTP 401$/);
  assert.equal(door3.images, images + 2);
  door3.imageStatus = 200;
  assert.equal((await hub.captureDoorbirdSnapshot(ID3)).length, 4);
  assert.equal((await hub.openDoorbirdDoor(ID3, 1, { quiet: true })).ok, true);
  assert.equal(door3.opens, opens + 4);
  assert.equal(logged(/^DoorBird Lieferzufahrt: Zugangsdaten abgelehnt/).length, 1, "keine neue Sperre");

  // Ein gelungenes Oeffnen zwischen zwei Ablehnungen der Dauerverbindung
  // beendet die Folge: Danach verbindet sie wieder, ohne Sperre.
  door3.monitor = [401, 401, "stream"];
  const requests = door3.monitorRequests;
  let mark = waits.length;
  dropStream(door3);
  await scheduled(3_000, mark);
  mark = waits.length;
  await advance(3_000);
  await until("erste Ablehnung", () => door3.monitorRequests === requests + 1);
  await scheduled(6_000, mark);
  assert.equal((await hub.openDoorbirdDoor(ID3, 1, { quiet: true })).ok, true);
  mark = waits.length;
  await advance(6_000);
  await until("zweite Ablehnung", () => door3.monitorRequests === requests + 2);
  await scheduled(12_000, mark);
  await advance(12_000);
  await until("wieder verbunden", () => door3.open.size === 1);
  assert.equal(door3.monitorRequests, requests + 3);
  assert.equal(logged(/^DoorBird Lieferzufahrt: Zugangsdaten abgelehnt/).length, 1, "keine Sperre");
  programs.arp = null;
});
