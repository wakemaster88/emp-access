import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

/*
 * soundweb.ts gegen Attrappen auf 127.0.0.1: eine Cloud (Konfiguration und
 * Zustandsmeldung) und ein Prozessor, der Verbindungen annimmt und schweigt.
 * Die Regeln stehen in soundweb-rules.ts und haben dort ihre Tests; hier
 * steht, dass soundweb.ts sie anwendet: seltener anwaehlen, getrennte Geraete
 * seltener melden, ein Auftrag verbindet sofort. Uhr und Timer gehen nur,
 * wenn der Test sie stellt; Verbindungen und Anfragen laufen echt.
 */

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
const MIN = 60_000;
mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: T0 });

/** Verbindungsversuche je Port (soundweb.ts ruft net.createConnection). */
const attempts = new Map<number, number>();
const realCreate = net.createConnection;
mock.method(net, "createConnection", (...args: unknown[]) => {
  const port = Number((args[0] as { port?: number })?.port);
  attempts.set(port, (attempts.get(port) ?? 0) + 1);
  return (realCreate as (...a: unknown[]) => net.Socket)(...args);
});

const reports: Array<{ devices: Array<{ id: number; connected: boolean; error: string | null }>; values: unknown[] }> = [];
let cloud: http.Server;
let dsp: net.Server;
const dspSockets = new Set<net.Socket>();
let deadPort = 0;
let dspPort = 0;

type Soundweb = typeof import("./soundweb.js");
let sw: Soundweb;

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 2_000; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`wartet vergeblich: ${what}`);
}

/** Uhr in Schritten vorstellen; zwischen den Schritten laufen Verbindungen und Anfragen. */
async function advance(ms: number, step = 1_000): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(Math.min(step, ms - t));
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }
}

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

before(async () => {
  deadPort = await freePort();
  dsp = net.createServer((sock) => {
    dspSockets.add(sock);
    sock.on("close", () => dspSockets.delete(sock));
    sock.on("error", () => undefined);
    // Antwortet auf jedes Abonnement mit demselben Rahmen: Das genuegt dem
    // Lebenszeichen des Hubs (alle 2 min), ein Wert kommt damit nicht an.
    sock.on("data", (chunk) => sock.write(chunk));
  });
  await new Promise<void>((r) => dsp.listen(0, "127.0.0.1", () => r()));
  dspPort = (dsp.address() as AddressInfo).port;

  cloud = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/hub/soundweb") {
        res.end(
          JSON.stringify({
            devices: [
              // Ohne einen einzigen Regler und nicht erreichbar.
              { id: 1, name: "Saal", host: "127.0.0.1", port: deadPort, node: 1, controls: [] },
              // Mit einem Regler, erreichbar.
              {
                id: 2,
                name: "Halle",
                host: "127.0.0.1",
                port: dspPort,
                node: 2,
                controls: [{ id: 21, name: "Pegel", kind: "GAIN", node: null, virtualDevice: 3, objectId: 256, stateVariable: 0 }],
              },
            ],
          })
        );
        return;
      }
      if (req.url === "/api/hub/soundweb/state") reports.push(JSON.parse(body));
      res.end("{}");
    });
  });
  await new Promise<void>((r) => cloud.listen(0, "127.0.0.1", () => r()));
  process.env.HUB_API_URL = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}`;
  process.env.HUB_API_TOKEN ??= "test";
  process.env.HUB_IMPROVE_LOG = "0";
  sw = await import("./soundweb.js");
});

after(() => {
  for (const s of dspSockets) s.destroy();
  dsp.close();
  cloud.close();
  mock.timers.reset();
});

const link = (id: number) => sw.soundwebLinkStates().find((l) => l.id === id);
const lastReport = () => reports[reports.length - 1];

test("Start: Geraet ohne Regler wird nach dem Fehlschlag erst nach 15 min wieder angewaehlt", async () => {
  sw.startSoundweb();
  await until(() => link(2)?.connected === true && link(1)?.lastError != null, "Halle verbunden, Saal gescheitert");
  assert.equal(attempts.get(deadPort), 1);
  // Gebuendelte Meldung nach 400 ms: beide Geraete mit Zustand.
  await advance(1_000, 100);
  const ids = new Set(reports.flatMap((r) => r.devices.map((d) => d.id)));
  assert.deepEqual([...ids].sort(), [1, 2]);
  await advance(14 * MIN - 2_000, 10_000);
  assert.equal(attempts.get(deadPort), 1, "vor 15 min kein neuer Versuch");
  await advance(2 * MIN, 10_000);
  assert.equal(attempts.get(deadPort), 2, "zweiter Versuch nach 15 min");
});

test("Minutentakt: verbundene jede Minute, das getrennte nur alle 10 min", async () => {
  const before = reports.length;
  await advance(10 * MIN, 10_000);
  const ticks = reports.slice(before).filter((r) => r.devices.some((d) => d.id === 2));
  assert.ok(ticks.length >= 10, `${ticks.length} Meldungen mit Halle`);
  assert.ok(ticks.every((r) => r.devices.some((d) => d.id === 2 && d.connected)));
  const withSaal = reports.slice(before).filter((r) => r.devices.some((d) => d.id === 1));
  assert.equal(withSaal.length, 1, "Saal einmal in zehn Minuten");
  assert.equal(withSaal[0].devices.find((d) => d.id === 1)?.connected, false);
});

test("Sync-Auftrag waehlt getrennte Geraete sofort an und meldet jedes Geraet", async () => {
  const tries = attempts.get(deadPort) ?? 0;
  const before = reports.length;
  const res = await sw.runSoundwebTask("SOUNDWEB_SYNC", null);
  assert.equal(res.success, true);
  assert.equal(attempts.get(deadPort), tries + 1);
  await until(() => reports.length > before, "Meldung nach dem Sync");
  const ids = new Set(reports.slice(before).flatMap((r) => r.devices.map((d) => d.id)));
  assert.ok(ids.has(1) && ids.has(2));
});

test("Stell-Auftrag an ein getrenntes Geraet verbindet sofort statt zu warten", async () => {
  // Prozessor faellt weg: Verbindung zu, Port zu.
  await new Promise<void>((r) => {
    dsp.close(() => r());
    for (const s of dspSockets) s.destroy();
  });
  await until(() => link(2)?.connected === false, "Halle getrennt");
  const tries = attempts.get(dspPort) ?? 0;
  const res = await sw.runSoundwebTask("SOUNDWEB_SET", { controlId: 21, raw: 0 });
  assert.equal(res.success, false);
  assert.match(res.error ?? "", /Halle nicht verbunden/);
  assert.equal(attempts.get(dspPort), tries + 1, "ein sofortiger Versuch");
  assert.ok(lastReport());
});
