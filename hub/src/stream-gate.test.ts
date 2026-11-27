import { test } from "node:test";
import assert from "node:assert/strict";
import { createStreamGate, STREAM_GATE_MAX_AGE_MS } from "./stream-gate.js";
import { MOWER_STREAM_PREFIX } from "./mower-streams.js";
import type { LiveModeCamera, LiveStream } from "./live-mode-rules.js";

const cams: LiveModeCamera[] = [
  { name: "Kamera A", host: "kamera-a.lan", kind: "REOLINK", liveMode: null },
  { name: "Kamera B", host: "kamera-b.lan", kind: "REOLINK", liveMode: "CLICK" },
  { name: "Kamera C", host: "kamera-c.lan", kind: "REOLINK", liveMode: "OFF" },
  // DoorBird ohne eigenen Stream: sie nimmt `doorbird`.
  { name: "Tor A", host: "tor-a.lan", kind: "DOORBIRD", liveMode: null },
];
const mower = `${MOWER_STREAM_PREFIX}eins`;
const streams: LiveStream[] = [
  { name: "a_sub", host: "kamera-a.lan" },
  { name: "b_sub", host: "kamera-b.lan" },
  { name: "c_sub", host: "kamera-c.lan" },
  { name: "doorbird", host: "tor-alt.lan" },
  { name: mower, host: null },
];

function gate(list: LiveModeCamera[] = cams, reachable = true) {
  const clock = { now: 1_000_000 };
  const calls = { fetch: 0 };
  const g = createStreamGate({
    cameras: () => list,
    fetchStreams: async () => {
      calls.fetch++;
      return { reachable, streams };
    },
    now: () => clock.now,
  });
  return { g, clock, calls };
}

test("Stream-Sperre der Zentrale: 403 fuer aus, durch fuer automatisch, nur auf Tippen, Maeher und doorbird", async () => {
  const { g } = gate();
  for (const sub of ["/webrtc", "/frame.jpeg"]) {
    assert.equal(await g.proxyStatus(sub, "c_sub"), 403, sub);
    assert.equal(await g.proxyStatus(sub, "a_sub"), null, sub);
    // „nur auf Tippen“: das Tippen prueft die Zentrale, der Hub laesst durch.
    assert.equal(await g.proxyStatus(sub, "b_sub"), null, sub);
    assert.equal(await g.proxyStatus(sub, mower), null, sub);
    assert.equal(await g.proxyStatus(sub, "doorbird"), null, sub);
    // Ein Name, den go2rtc nicht meldet, ist gesperrt.
    assert.equal(await g.proxyStatus(sub, "x_sub"), 403, sub);
  }
  // Andere Pfade liefern kein Bild und bleiben unberuehrt.
  assert.equal(await g.proxyStatus("/streams", "c_sub"), null);
});

test("Personen-Boxen: 403 bei Kamera aus oder gesperrtem Stream", async () => {
  const { g } = gate();
  assert.equal(await g.boxesStatus("auto", "a_sub"), null);
  assert.equal(await g.boxesStatus(null, "a_sub"), null);
  assert.equal(await g.boxesStatus("click", "b_sub"), null);
  assert.equal(await g.boxesStatus("off", "a_sub"), 403);
  assert.equal(await g.boxesStatus("OFF", "a_sub"), 403);
  assert.equal(await g.boxesStatus("auto", "c_sub"), 403);
  assert.equal(await g.boxesStatus("auto", "doorbird"), null);
});

test("DoorBird aus: doorbird gesperrt", async () => {
  const list = cams.map((c) => (c.kind === "DOORBIRD" ? { ...c, liveMode: "OFF" } : c));
  const { g } = gate(list);
  assert.equal(await g.proxyStatus("/webrtc", "doorbird"), 403);
  assert.equal(await g.proxyStatus("/webrtc", "a_sub"), null);
});

test("Ohne Kamera-Liste bleibt alles erlaubt, ohne go2rtc zu fragen", async () => {
  const { g, calls } = gate([]);
  assert.equal(await g.proxyStatus("/webrtc", "c_sub"), null);
  assert.equal(await g.boxesStatus(null, "x_sub"), null);
  assert.equal(calls.fetch, 0);
});

test("Stream-Liste hoechstens 10 s alt, unbekannter Name liest neu, ohne go2rtc gilt die letzte gute Liste", async () => {
  const { g, clock, calls } = gate();
  await g.allows("a_sub");
  assert.equal(calls.fetch, 1);
  await g.allows("c_sub");
  assert.equal(calls.fetch, 1);
  // Maeher fragt nie.
  await g.allows(mower);
  assert.equal(calls.fetch, 1);
  // Unbekannter Name: neu lesen.
  await g.allows("x_sub");
  assert.equal(calls.fetch, 2);
  clock.now += STREAM_GATE_MAX_AGE_MS;
  await g.allows("a_sub");
  assert.equal(calls.fetch, 3);

  // go2rtc antwortet nicht: die zuletzt gemerkte Liste gilt weiter.
  const off = createStreamGate({
    cameras: () => cams,
    fetchStreams: async () => ({ reachable: false, streams: [] }),
  });
  off.note({ reachable: true, streams });
  off.note({ reachable: false, streams: [] });
  assert.equal(await off.proxyStatus("/webrtc", "c_sub"), 403);
  assert.equal(await off.proxyStatus("/webrtc", "a_sub"), null);
});
