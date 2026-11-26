/**
 * Gemeinsamer Tracker-Aufruf (tracker-client.ts) gegen eine Attrappe des
 * Trackers auf 127.0.0.1: PIN, Zeitlimit, Ausschnitt in der Query, Zähler je
 * Aufrufer und Ausfallschalter. Die Regeln stehen in tracker-client-rules.ts
 * und haben dort ihre Tests; hier steht, dass der Aufruf sie benutzt.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Client = typeof import("./tracker-client.js");

let server: http.Server;
let url = "";
let mod: Client;
/** Was die Attrappe antwortet: Status und Rumpf, oder "hang" (antwortet nie). */
let reply: { status: number; body: unknown } | "hang" = { status: 200, body: {} };
let requests: Array<{ url: string; token: string | undefined; bytes: number }> = [];
const PIN = "1234";
let requirePin = false;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => {
      const token = req.headers["x-admin-token"] as string | undefined;
      requests.push({ url: req.url ?? "", token, bytes: Buffer.concat(chunks).length });
      if (requirePin && token !== PIN) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "unauthorized" }));
        return;
      }
      if (reply === "hang") return;
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Vor dem Import: config.ts liest die Umgebung beim Laden. Keine Diagnose-Dateien.
  process.env.HUB_API_URL ??= "http://127.0.0.1:9";
  process.env.HUB_API_TOKEN ??= "test";
  process.env.HUB_IMPROVE_LOG = "0";
  mod = await import("./tracker-client.js");
});

after(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  reply = { status: 200, body: {} };
  requests = [];
  requirePin = false;
});

function client(opts: { pin?: string; timeoutMs?: number } = {}) {
  let clock = 1_000_000;
  const logs: string[] = [];
  const counts = new Map<string, number>();
  const notes: string[] = [];
  const c = mod.createTrackerClient({
    target: async () => ({ url, pin: opts.pin ?? "" }),
    timeoutMs: opts.timeoutMs ?? 2_000,
    now: () => clock,
    log: (m) => logs.push(m),
    count: (e) => counts.set(e, (counts.get(e) ?? 0) + 1),
    note: (e) => notes.push(e),
  });
  return {
    c,
    logs,
    counts,
    notes,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

test("schickt die PIN mit, wo der Tracker sie verlangt", async () => {
  requirePin = true;
  reply = { status: 200, body: { persons: [] } };
  const without = client();
  const a = await without.c.classify(JPEG, { caller: "persons" });
  assert.equal(a.ok, false);
  assert.equal(!a.ok && a.status, 401);
  assert.equal(without.counts.get("persons.fail"), 1);

  const withPin = client({ pin: PIN });
  const b = await withPin.c.classify(JPEG, { caller: "persons" });
  assert.equal(b.ok, true);
  assert.deepEqual(b.ok && b.json, { persons: [] });
  assert.equal(requests.at(-1)?.token, PIN);
  assert.equal(requests.at(-1)?.bytes, JPEG.length);
  assert.equal(withPin.counts.get("persons.ok"), 1);
});

test("ohne Ausschnitt geht /classify ohne Query hinaus, mit Ausschnitt mit roi und imgsz", async () => {
  reply = { status: 200, body: { vehicles: [] } };
  const t = client();
  await t.c.classify(JPEG, { caller: "noparking" });
  await t.c.classify(JPEG, { caller: "noparking_shadow", roi: { x: 0.5, y: 0.1, w: 0.4, h: 0.5 }, imgsz: 1280 });
  assert.equal(requests[0].url, "/classify");
  const q = new URL(requests[1].url, "http://x").searchParams;
  assert.equal(q.get("roi"), "0.5000,0.1000,0.4000,0.5000");
  assert.equal(q.get("imgsz"), "1280");
  assert.equal(t.counts.get("noparking.ok"), 1);
  assert.equal(t.counts.get("noparking_shadow.ok"), 1);
});

test("nach 2 Fehlern in Folge 30 s lang kein Netzaufruf, danach wieder; je Wechsel eine Zeile", async () => {
  reply = { status: 500, body: { detail: "boom" } };
  const t = client();
  await t.c.classify(JPEG, { caller: "vehicle" });
  await t.c.classify(JPEG, { caller: "persons" });
  assert.equal(requests.length, 2);
  assert.equal(t.logs.length, 1);
  assert.match(t.logs[0], /2 Fehler in Folge .*HTTP 500.* 30 s als aus/);

  const off = await t.c.classify(JPEG, { caller: "live" });
  assert.deepEqual(off, { ok: false, reason: "off", status: null, error: "Tracker gilt als aus" });
  assert.equal(requests.length, 2, "kein Aufruf, solange der Tracker als aus gilt");
  assert.equal(t.counts.get("live.off"), 1);

  t.advance(29_999);
  await t.c.classify(JPEG, { caller: "live" });
  assert.equal(requests.length, 2);

  t.advance(1);
  reply = { status: 200, body: { vehicles: [] } };
  const back = await t.c.classify(JPEG, { caller: "vehicle" });
  assert.equal(back.ok, true);
  assert.equal(requests.length, 3);
  assert.equal(t.logs.length, 2);
  assert.match(t.logs[1], /Tracker antwortet wieder \(war 30 s aus\)/);
  assert.deepEqual(t.notes, ["down", "up"]);
  assert.equal(t.counts.get("vehicle.fail"), 1);
  assert.equal(t.counts.get("vehicle.ok"), 1);
  assert.equal(t.counts.get("persons.fail"), 1);
  assert.equal(t.counts.get("live.off"), 2);
});

test("Zeitlimit: hängt der Tracker, endet der Aufruf mit Fehler und zählt für den Ausfallschalter", async () => {
  reply = "hang";
  const t = client({ timeoutMs: 150 });
  const started = Date.now();
  const r = await t.c.classify(JPEG, { caller: "noparking" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "error");
  assert.ok(Date.now() - started < 2_000);
  await t.c.classify(JPEG, { caller: "noparking" });
  assert.equal(t.c.breaker().down, true);
});

test("ein unbrauchbares Bild (400) sperrt den Tracker nicht", async () => {
  reply = { status: 400, body: { detail: "invalid jpeg" } };
  const t = client();
  for (let i = 0; i < 3; i++) {
    const r = await t.c.classify(JPEG, { caller: "vehicle" });
    assert.equal(!r.ok && r.reason, "http");
  }
  assert.equal(requests.length, 3);
  assert.equal(t.c.breaker().down, false);
  assert.equal(t.logs.length, 0);
});

test("Antwort ohne JSON: Fehler für den Aufrufer, der Tracker hat aber geantwortet", async () => {
  reply = { status: 200, body: "kein json" };
  const t = client();
  const r = await t.c.classify(JPEG, { caller: "live" });
  assert.equal(!r.ok && r.reason, "error");
  await t.c.classify(JPEG, { caller: "live" });
  assert.equal(t.c.breaker().down, false);
});

test("Tracker nicht erreichbar: Fehler, kein Wurf", async () => {
  const c = mod.createTrackerClient({
    target: async () => ({ url: "http://127.0.0.1:9", pin: "" }),
    timeoutMs: 1_000,
    log: () => undefined,
    count: () => undefined,
  });
  const r = await c.classify(JPEG, { caller: "vehicle" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "error");
});

test("Vergleichsaufruf (probe) verändert den Ausfallschalter nicht, geht aber nicht hinaus, solange der Tracker als aus gilt", async () => {
  reply = { status: 500, body: {} };
  const t = client();
  for (let i = 0; i < 3; i++) await t.c.classify(JPEG, { caller: "noparking_shadow", probe: true });
  assert.equal(requests.length, 3);
  assert.equal(t.c.breaker().down, false);
  assert.equal(t.c.breaker().fails, 0);
  assert.equal(t.counts.get("noparking_shadow.fail"), 3);

  await t.c.classify(JPEG, { caller: "noparking" });
  await t.c.classify(JPEG, { caller: "noparking" });
  assert.equal(t.c.breaker().down, true);
  const off = await t.c.classify(JPEG, { caller: "noparking_shadow", probe: true });
  assert.equal(!off.ok && off.reason, "off");
  assert.equal(requests.length, 5);

  // Ein gelungener Vergleichsaufruf nach der Sperre beendet sie nicht; das tut erst ein gewöhnlicher Aufruf.
  t.advance(30_000);
  reply = { status: 200, body: { vehicles: [], roi: [0, 0, 1, 1] } };
  assert.equal((await t.c.classify(JPEG, { caller: "noparking_shadow", probe: true })).ok, true);
  assert.equal(t.c.breaker().down, true);
  assert.equal(t.logs.length, 1);
  assert.equal((await t.c.classify(JPEG, { caller: "noparking" })).ok, true);
  assert.equal(t.c.breaker().down, false);
  assert.equal(t.logs.length, 2);
});

test("Ausgang je Aufruf für den Hinweis „in Folge“: Fehlertext oder null, Vergleichsaufrufe nicht", async () => {
  const outcomes: Array<string | null> = [];
  const c = mod.createTrackerClient({
    target: async () => ({ url, pin: "" }),
    timeoutMs: 2_000,
    log: () => undefined,
    count: () => undefined,
    outcome: (e) => outcomes.push(e),
  });
  reply = { status: 500, body: {} };
  await c.classify(JPEG, { caller: "vehicle" });
  await c.classify(JPEG, { caller: "noparking_shadow", probe: true });
  reply = { status: 200, body: { vehicles: [] } };
  await c.classify(JPEG, { caller: "vehicle" });
  assert.deepEqual(outcomes, ["HTTP 500", null]);
});
