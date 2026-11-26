import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SHELLY_SWITCH_RETRY_MS } from "./shelly-rules.js";

/*
 * shelly.ts gegen zwei Shellys als Attrappe auf 127.0.0.1 (Gen2 und Gen1,
 * ohne Passwort): gemerkte Generation und die einmalige Wiederholung eines
 * Schaltbefehls. Die Regeln stehen in shelly-rules.ts und haben dort ihre
 * Tests; hier steht, dass shelly.ts sie anwendet. Der Test laedt wie
 * shelly-auth.test.ts eine Kopie von hub/src aus einem eigenen Verzeichnis.
 * Die Uhr (Date) geht nur, wenn der Test sie stellt; Anfragen laufen echt.
 */

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
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

/** Antwort je Pfad: ok, Verbindung abbrechen, HTTP 500, abbrechen nach Wartezeit. */
type Mode = "ok" | "reset" | "500" | "slow-reset";

function dummy(gen: 1 | 2) {
  const d = {
    server: http.createServer(),
    hits: new Map<string, number>(),
    /** Naechste Antworten je Pfad (ohne Abfrage), danach "ok". */
    plan: new Map<string, Mode[]>(),
    output: false,
  };
  d.server.on("request", (req, res) => {
    res.setHeader("Connection", "close");
    const url = new URL(req.url ?? "/", "http://x");
    const key = url.pathname + (url.search ? url.search : "");
    d.hits.set(url.pathname, (d.hits.get(url.pathname) ?? 0) + 1);
    if (key !== url.pathname) d.hits.set(key, (d.hits.get(key) ?? 0) + 1);
    const mode = d.plan.get(url.pathname)?.shift() ?? "ok";
    if (mode === "reset") return void req.socket.destroy();
    if (mode === "slow-reset") return void setTimeout(() => req.socket.destroy(), 150);
    if (mode === "500") return void res.writeHead(500).end();
    const json = (body: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    if (url.pathname === "/shelly") {
      return gen === 2
        ? json({ gen: 2, model: "SNSW-001X16EU", app: "Plus1", mac: "02005E100010", auth_en: false })
        : json({ type: "SHSW-1", mac: "02005E100011", auth: false });
    }
    if (url.pathname === "/rpc/Switch.Set" || url.pathname === "/rpc/Switch.Toggle") {
      const wasOn = d.output;
      d.output = url.pathname === "/rpc/Switch.Toggle" ? !d.output : url.searchParams.get("on") === "true";
      return json({ was_on: wasOn });
    }
    if (url.pathname.startsWith("/relay/")) {
      const turn = url.searchParams.get("turn");
      d.output = turn === "toggle" ? !d.output : turn === "on";
      return json({ ison: d.output });
    }
    if (url.pathname === "/rpc/Switch.GetStatus") return json({ id: 0, output: d.output });
    if (url.pathname === "/rpc/Shelly.GetStatus") return json({ "switch:0": { id: 0, output: d.output, apower: 0 }, sys: { uptime: 5 } });
    if (url.pathname === "/status") return json({ relays: [{ ison: d.output }], meters: [{ power: 0 }], uptime: 5 });
    res.writeHead(404).end();
  });
  return d;
}

const gen2 = dummy(2);
const gen1 = dummy(1);
let host2 = "";
let host1 = "";
let shelly: typeof import("./shelly.js");

function claimSandbox(): string {
  for (let n = 0; ; n++) {
    const dir = path.join(os.tmpdir(), `emp-hub-shelly-retry-${n}`);
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
  for (const d of [gen2, gen1]) await new Promise<void>((r) => d.server.listen(0, "127.0.0.1", r));
  host2 = `127.0.0.1:${(gen2.server.address() as AddressInfo).port}`;
  host1 = `127.0.0.1:${(gen1.server.address() as AddressInfo).port}`;
  for (const key of Object.keys(process.env)) if (/^(HUB|FACE)_/.test(key)) delete process.env[key];
  process.env.HUB_API_URL = "http://127.0.0.1:9";
  process.env.HUB_API_TOKEN = "attrappe";
  process.env.HUB_IMPROVE_LOG = "0";
  shelly = await import(pathToFileURL(path.join(hubDir, "src", "shelly.ts")).href);
});

after(() => {
  mock.timers.reset();
  for (const d of [gen2, gen1]) {
    d.server.closeAllConnections();
    d.server.unref();
  }
});

const hits = (d: ReturnType<typeof dummy>, p: string) => d.hits.get(p) ?? 0;
const retryLines = () => hubLog.filter((l) => /einmal wiederholt$/.test(l));

test("Generation: eine Abfrage von /shelly je Stunde, nach einem Fehler sofort neu", async () => {
  await shelly.shellyStatus(host2);
  await shelly.shellyStatus(host2);
  await shelly.shellySwitch(host2, 0, false);
  assert.equal(hits(gen2, "/shelly"), 1, "eine Abfrage fuer drei Aufrufe");
  advance(59 * 60_000);
  await shelly.shellyStatus(host2);
  assert.equal(hits(gen2, "/shelly"), 1);
  advance(60_000);
  await shelly.shellyStatus(host2);
  assert.equal(hits(gen2, "/shelly"), 2, "nach einer Stunde neu");
  gen2.plan.set("/rpc/Shelly.GetStatus", ["500"]);
  await assert.rejects(shelly.shellyStatus(host2), /HTTP 500/);
  await shelly.shellyStatus(host2);
  assert.equal(hits(gen2, "/shelly"), 3, "nach dem Fehler neu");
});

test("Aus: nach einem Verbindungsabbruch genau einmal wiederholt; an nicht, es kann angekommen sein", async () => {
  const before = hits(gen2, "/rpc/Switch.Set");
  const retried = retryLines().length;
  gen2.plan.set("/rpc/Switch.Set", ["reset"]);
  await assert.rejects(shelly.shellySwitch(host2, 0, true), /fetch failed/);
  assert.equal(hits(gen2, "/rpc/Switch.Set"), before + 1, "an: ein Versuch");
  gen2.plan.set("/rpc/Switch.Set", ["reset"]);
  assert.deepEqual(await shelly.shellySwitch(host2, 0, false), { on: false });
  assert.equal(hits(gen2, "/rpc/Switch.Set"), before + 3);
  assert.deepEqual(retryLines().slice(retried), [
    `Shelly ${host2} Kanal 0: Schaltbefehl „aus“ ohne Antwort (Netzfehler), einmal wiederholt`,
  ]);
  // Scheitert auch die Wiederholung, bleibt es bei zwei Versuchen.
  gen2.plan.set("/rpc/Switch.Set", ["reset", "reset", "reset"]);
  await assert.rejects(shelly.shellySwitch(host2, 0, false), /fetch failed/);
  assert.equal(hits(gen2, "/rpc/Switch.Set"), before + 5);
  gen2.plan.delete("/rpc/Switch.Set");
});

test("An: wiederholt, wenn die Verbindung gar nicht zustande kam", async () => {
  const before = hits(gen2, "/rpc/Switch.Set?id=0&on=true");
  const retried = retryLines().length;
  // Der erste Schaltbefehl erreicht den Shelly nicht (Verbindung abgelehnt).
  const realFetch = globalThis.fetch;
  let refused = 0;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/rpc/Switch.Set") && refused === 0) {
      refused++;
      return Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) }));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    assert.deepEqual(await shelly.shellySwitch(host2, 0, true), { on: true });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(refused, 1);
  assert.equal(hits(gen2, "/rpc/Switch.Set?id=0&on=true"), before + 1, "die Wiederholung kam an");
  assert.deepEqual(retryLines().slice(retried), [
    `Shelly ${host2} Kanal 0: Schaltbefehl „an“ ohne Antwort (Netzfehler), einmal wiederholt`,
  ]);
  await shelly.shellySwitch(host2, 0, false);
});

test("Umschalten, Impuls und HTTP-Fehler werden nie wiederholt", async () => {
  const retried = retryLines().length;
  const toggles = hits(gen2, "/rpc/Switch.Toggle");
  gen2.plan.set("/rpc/Switch.Toggle", ["reset"]);
  await assert.rejects(shelly.shellySwitch(host2, 0, "toggle"), /fetch failed/);
  assert.equal(hits(gen2, "/rpc/Switch.Toggle"), toggles + 1);

  const sets = hits(gen2, "/rpc/Switch.Set");
  gen2.plan.set("/rpc/Switch.Set", ["reset"]);
  await assert.rejects(shelly.shellySwitch(host2, 0, true, 3), /fetch failed/);
  assert.equal(hits(gen2, "/rpc/Switch.Set"), sets + 1, "Impuls (an mit Selbstabschaltung) einmal");

  gen2.plan.set("/rpc/Switch.Set", ["500"]);
  await assert.rejects(shelly.shellySwitch(host2, 0, false), /HTTP 500/);
  assert.equal(hits(gen2, "/rpc/Switch.Set"), sets + 2);

  const relay = hits(gen1, "/relay/0");
  gen1.plan.set("/relay/0", ["reset"]);
  await assert.rejects(shelly.shellySwitch(host1, 0, "toggle"), /fetch failed/);
  gen1.plan.set("/relay/0", ["reset"]);
  await assert.rejects(shelly.shellySwitch(host1, 0, true, 30), /fetch failed/);
  assert.equal(hits(gen1, "/relay/0"), relay + 2);
  assert.equal(retryLines().length, retried, "keine Wiederholung");
});

test("Gen1: aus nach Abbruch einmal wiederholt", async () => {
  const relay = hits(gen1, "/relay/0");
  const off = hits(gen1, "/relay/0?turn=off");
  gen1.plan.set("/relay/0", ["reset"]);
  assert.deepEqual(await shelly.shellySwitch(host1, 0, false), { on: false });
  assert.equal(hits(gen1, "/relay/0"), relay + 2);
  assert.equal(hits(gen1, "/relay/0?turn=off"), off + 2);
});

test("Ein neuerer Befehl fuer denselben Kanal verhindert die Wiederholung des aelteren", async () => {
  const on = hits(gen2, "/rpc/Switch.Set?id=0&on=true");
  const off = hits(gen2, "/rpc/Switch.Set?id=0&on=false");
  gen2.plan.set("/rpc/Switch.Set", ["slow-reset"]);
  const first = shelly.shellySwitch(host2, 0, false);
  const firstDone = first.then(
    () => "ok",
    (e: Error) => e.message
  );
  // Waehrend das „aus“ noch auf Antwort wartet, kommt „an“.
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(await shelly.shellySwitch(host2, 0, true), { on: true });
  assert.equal(await firstDone, "fetch failed");
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(hits(gen2, "/rpc/Switch.Set?id=0&on=false"), off + 1, "das aeltere „aus“ nicht wiederholt");
  assert.equal(hits(gen2, "/rpc/Switch.Set?id=0&on=true"), on + 1);
  assert.equal(gen2.output, true);
});

test("Ein neuerer Befehl in der Pause vor der Wiederholung verhindert sie", async () => {
  const on = hits(gen2, "/rpc/Switch.Set?id=0&on=true");
  const off = hits(gen2, "/rpc/Switch.Set?id=0&on=false");
  const retried = retryLines().length;
  // Die Pause vor der Wiederholung haelt der Test an, bis der neuere Befehl durch ist.
  const realSetTimeout = globalThis.setTimeout;
  let releasePause: (() => void) | null = null;
  const pauseStarted = new Promise<void>((started) => {
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      if (ms === SHELLY_SWITCH_RETRY_MS && !releasePause) {
        releasePause = () => fn(...args);
        started();
        return realSetTimeout(() => undefined, 0);
      }
      return realSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout;
  });
  try {
    // „aus“ scheitert am Netz; der Hub wartet vor der Wiederholung.
    gen2.plan.set("/rpc/Switch.Set", ["reset"]);
    const first = shelly.shellySwitch(host2, 0, false).then(
      () => "ok",
      (e: Error) => e.message
    );
    await pauseStarted;
    assert.equal(hits(gen2, "/rpc/Switch.Set?id=0&on=false"), off + 1);
    // In der Pause kommt „an“ fuer denselben Kanal und geht durch.
    assert.deepEqual(await shelly.shellySwitch(host2, 0, true), { on: true });
    releasePause!();
    assert.equal(await first, "fetch failed", "das aeltere „aus“ kommt als Fehler zurueck");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(hits(gen2, "/rpc/Switch.Set?id=0&on=false"), off + 1, "das aeltere „aus“ nach der Pause nicht wiederholt");
  assert.equal(hits(gen2, "/rpc/Switch.Set?id=0&on=true"), on + 1);
  assert.equal(gen2.output, true);
  assert.equal(retryLines().length, retried);
});
