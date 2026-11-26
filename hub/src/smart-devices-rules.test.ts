import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_FORCE_MIN_MS,
  DISCOVERY_RETRY_MS,
  DISCOVERY_TTL_MS,
  PROBE_CONCURRENCY,
  PROBE_HIT_TTL_MS,
  PROBE_MISS_TTL_MS,
  discoveryDue,
  hueUnpairAllowed,
  mapPool,
  probeCandidates,
  probeFresh,
  probeKey,
  pruneProbes,
} from "./smart-devices-rules.js";

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
const H = 3_600_000;

test("probeKey: Adresse plus MAC, ohne Port, MAC gross", () => {
  assert.equal(probeKey("192.168.1.20", "02:00:5e:10:00:20"), "192.168.1.20|02:00:5E:10:00:20");
  assert.equal(probeKey("192.168.1.20:80", null), "192.168.1.20|");
  assert.notEqual(probeKey("192.168.1.20", "02:00:5E:10:00:20"), probeKey("192.168.1.20", "02:00:5E:10:00:21"));
});

test("probeFresh: Treffer 15 min, erfolglos 24 h, Uhr zurueck gilt als abgelaufen", () => {
  assert.equal(PROBE_HIT_TTL_MS, 15 * 60_000);
  assert.equal(PROBE_MISS_TTL_MS, 24 * H);
  assert.equal(probeFresh(undefined, T0), false);
  assert.equal(probeFresh({ at: T0, found: true }, T0 + PROBE_HIT_TTL_MS - 1), true);
  assert.equal(probeFresh({ at: T0, found: true }, T0 + PROBE_HIT_TTL_MS), false);
  assert.equal(probeFresh({ at: T0, found: false }, T0 + 23 * H), true);
  assert.equal(probeFresh({ at: T0, found: false }, T0 + 24 * H), false);
  assert.equal(probeFresh({ at: T0, found: false }, T0 - 1), false);
});

test("pruneProbes: entfernt nur Abgelaufene", () => {
  const cache = new Map([
    ["a", { at: T0, found: true }],
    ["b", { at: T0, found: false }],
    ["c", { at: T0 - 25 * H, found: false }],
  ]);
  assert.equal(pruneProbes(cache, T0 + 20 * 60_000), 2);
  assert.deepEqual([...cache.keys()], ["b"]);
});

test("probeCandidates: kein Shelly, Port 80, eingerichtete Kameras, DoorBirds und Switches nie", () => {
  const dev = (ip: string, o: Partial<{ mac: string | null; openPorts: number[]; shelly: unknown }> = {}) => ({
    ip,
    mac: null as string | null,
    openPorts: [80],
    ...o,
  });
  const scan = [
    dev("192.168.1.10"), // Tasmota-Kandidat
    dev("192.168.1.11", { openPorts: [443] }), // ohne Port 80
    dev("192.168.1.12", { shelly: { gen: 2 } }), // Shelly, eigener Weg
    dev("192.168.1.13"), // Kamera (Adresse)
    dev("192.168.1.14", { mac: "02:00:5e:10:00:14" }), // Kamera unter neuer Adresse (MAC)
    dev("192.168.1.15"), // DoorBird
    dev("192.168.1.16"), // Switch, als Ziel mit Port eingetragen
    dev("192.168.1.17", { mac: "02:00:5E:10:00:17" }),
  ];
  const { candidates, skippedKnown } = probeCandidates(scan, {
    hosts: ["192.168.1.13", "192.168.1.15", "192.168.1.16:161", " 192.168.1.99 "],
    macs: ["02:00:5E:10:00:14", null, undefined],
  });
  assert.deepEqual(
    candidates.map((d) => d.ip),
    ["192.168.1.10", "192.168.1.17"]
  );
  assert.equal(skippedKnown, 4);
});

test("discoveryDue: 6 h nach einer Antwort, 30 min nach einem Fehler, beim Oeffnen hoechstens je Minute", () => {
  assert.equal(DISCOVERY_TTL_MS, 6 * H);
  assert.equal(discoveryDue({ at: 0, ok: false }, T0), true, "beim Start");
  const ok = { at: T0, ok: true };
  assert.equal(discoveryDue(ok, T0 + 6 * H - 1), false);
  assert.equal(discoveryDue(ok, T0 + 6 * H), true);
  const failed = { at: T0, ok: false };
  assert.equal(discoveryDue(failed, T0 + DISCOVERY_RETRY_MS - 1), false);
  assert.equal(discoveryDue(failed, T0 + DISCOVERY_RETRY_MS), true);
  // Geraeteliste geoeffnet.
  assert.equal(discoveryDue(ok, T0 + DISCOVERY_FORCE_MIN_MS - 1, true), false);
  assert.equal(discoveryDue(ok, T0 + DISCOVERY_FORCE_MIN_MS, true), true);
  // Uhr zurueckgestellt: lieber einmal suchen als nie wieder.
  assert.equal(discoveryDue(ok, T0 - 1), true);
});

test("hueUnpairAllowed: nur wenn unter der Adresse dieselbe Bridge antwortet", () => {
  assert.equal(hueUnpairAllowed("001788fffe100020", "001788fffe100020"), true);
  assert.equal(hueUnpairAllowed("001788fffe100020", "001788FFFE100020"), true);
  assert.equal(hueUnpairAllowed("001788fffe100020", "001788fffe100021"), false, "andere Bridge unter der alten Adresse");
  assert.equal(hueUnpairAllowed("001788fffe100020", null), false, "keine Antwort");
  assert.equal(hueUnpairAllowed("001788fffe100020", undefined), false);
});

test("mapPool: hoechstens 8 gleichzeitig, Reihenfolge bleibt", async () => {
  assert.equal(PROBE_CONCURRENCY, 8);
  let running = 0;
  let peak = 0;
  const items = Array.from({ length: 30 }, (_, i) => i);
  const out = await mapPool(items, PROBE_CONCURRENCY, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, (n * 7) % 5));
    running--;
    return n * 2;
  });
  assert.equal(peak, 8);
  assert.deepEqual(
    out,
    items.map((n) => n * 2)
  );
  assert.deepEqual(await mapPool([], 8, async () => 1), []);
  assert.deepEqual(await mapPool([1, 2], 8, async (n) => n + 1), [2, 3]);
});
