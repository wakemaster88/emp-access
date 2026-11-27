import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedStreams,
  previewUploadAllowed,
  readLiveMode,
  streamAllowed,
  type LiveModeCamera,
  type LiveStream,
} from "./live-mode-rules.js";

test("readLiveMode: leer und AUTO automatisch, CLICK und OFF, Unbekanntes wie nur auf Tippen", () => {
  assert.equal(readLiveMode(null), "auto");
  assert.equal(readLiveMode(undefined), "auto");
  assert.equal(readLiveMode(""), "auto");
  assert.equal(readLiveMode("  "), "auto");
  assert.equal(readLiveMode("AUTO"), "auto");
  assert.equal(readLiveMode("auto"), "auto");
  assert.equal(readLiveMode("CLICK"), "click");
  assert.equal(readLiveMode(" off "), "off");
  assert.equal(readLiveMode("OFF"), "off");
  for (const v of ["NACHTS", "TAP", 1, true, {}]) assert.equal(readLiveMode(v), "click", String(v));
});

test("Vorschaubild in die Cloud nur bei automatisch", () => {
  assert.equal(previewUploadAllowed(null), true);
  assert.equal(previewUploadAllowed(undefined), true);
  assert.equal(previewUploadAllowed("AUTO"), true);
  assert.equal(previewUploadAllowed("CLICK"), false);
  assert.equal(previewUploadAllowed("OFF"), false);
  assert.equal(previewUploadAllowed("unbekannt"), false);
});

const cams: LiveModeCamera[] = [
  { name: "Kamera A", host: "kamera-a.lan", kind: "REOLINK", liveMode: null },
  { name: "Kamera B", host: "Kamera-B.lan ", kind: "REOLINK", liveMode: "CLICK" },
  { name: "Kamera C", host: "kamera-c.lan", kind: "REOLINK", liveMode: "OFF" },
];
const streams: LiveStream[] = [
  { name: "a_main", host: "kamera-a.lan" },
  { name: "a_sub", host: "kamera-a.lan" },
  { name: "b_sub", host: "kamera-b.lan" },
  { name: "c_main", host: "kamera-c.lan" },
  { name: "c_sub", host: "KAMERA-C.lan" },
];

test("Streams je Kamera über den Host: aus gesperrt, automatisch und nur auf Tippen erlaubt", () => {
  assert.deepEqual(allowedStreams(cams, streams), {
    allowed: ["a_main", "a_sub", "b_sub"],
    denied: ["c_main", "c_sub"],
  });
});

test("Ohne Kamera-Liste bleibt alles wie bisher erlaubt", () => {
  assert.deepEqual(allowedStreams([], streams), {
    allowed: streams.map((s) => s.name),
    denied: [],
  });
  assert.equal(streamAllowed([], streams, "c_sub"), true);
  assert.equal(streamAllowed([], streams, "gibt_es_nicht"), true);
});

test("Streams ohne Kamera: gesperrt, sobald die Kamera-Liste bekannt ist", () => {
  const extra: LiveStream[] = [
    ...streams,
    { name: "fremd_sub", host: "fremd.lan" },
    { name: "a_h264", host: null },
    { name: "lokal", host: "127.0.0.1" },
  ];
  const r = allowedStreams(cams, extra);
  assert.deepEqual(r.denied, ["c_main", "c_sub", "fremd_sub", "a_h264", "lokal"]);
  // Nicht (mehr) in go2rtc: gesperrt.
  assert.equal(streamAllowed(cams, extra, "gibt_es_nicht"), false);
  assert.equal(streamAllowed(cams, extra, "a_sub"), true);
  assert.equal(streamAllowed(cams, extra, "c_main"), false);
});

test("Mäher-Streams bleiben immer erlaubt", () => {
  const list: LiveStream[] = [
    { name: "mower_a_1", host: null },
    { name: "mower_a_1_h264", host: null },
  ];
  assert.deepEqual(allowedStreams(cams, list), { allowed: ["mower_a_1", "mower_a_1_h264"], denied: [] });
  assert.equal(streamAllowed(cams, [], "mower_a_1_h264"), true);
});

test("Gemeinsamer Host (Rekorder): aus gewinnt", () => {
  const nvr: LiveModeCamera[] = [
    { name: "Kamera A", host: "rekorder.lan", liveMode: null },
    { name: "Kamera B", host: "rekorder.lan", liveMode: "OFF" },
  ];
  const r = allowedStreams(nvr, [{ name: "kanal1", host: "rekorder.lan" }]);
  assert.deepEqual(r, { allowed: [], denied: ["kanal1"] });
});

test("DoorBird: eigener Stream über den Host, sonst der Stream doorbird", () => {
  const door = (liveMode: string | null): LiveModeCamera => ({
    name: "Tor A",
    host: "tor-a.lan",
    kind: "DOORBIRD",
    liveMode,
  });
  // Kein eigener Stream: `doorbird` gehoert zur DoorBird.
  const fallback: LiveStream[] = [{ name: "doorbird", host: "tor-alt.lan" }];
  assert.deepEqual(allowedStreams([door(null)], fallback).allowed, ["doorbird"]);
  assert.deepEqual(allowedStreams([door("CLICK")], fallback).allowed, ["doorbird"]);
  assert.deepEqual(allowedStreams([door("OFF")], fallback).denied, ["doorbird"]);
  // Eigener Stream mit ihrem Host: der zaehlt, `doorbird` mit fremdem Host gehoert keiner DoorBird.
  const own: LiveStream[] = [
    { name: "tor_a", host: "tor-a.lan" },
    { name: "doorbird", host: "tor-alt.lan" },
  ];
  assert.deepEqual(allowedStreams([door(null)], own), { allowed: ["tor_a", "doorbird"], denied: [] });
  // Ist eine DoorBird aus, bleibt ein `doorbird` ohne Zuordnung gesperrt.
  assert.deepEqual(allowedStreams([door("OFF")], own), { allowed: [], denied: ["tor_a", "doorbird"] });
  // Ohne DoorBird in der Liste: `doorbird` wie bisher erlaubt.
  assert.deepEqual(allowedStreams(cams, [{ name: "doorbird", host: null }]).allowed, ["doorbird"]);
});

test("Zwei DoorBirds: der Stream doorbird gehoert der DoorBird mit seinem Host", () => {
  const doorA = (liveMode: string | null): LiveModeCamera => ({
    name: "Tor A",
    host: "tor-a.lan",
    kind: "DOORBIRD",
    liveMode,
  });
  const doorB = (liveMode: string | null): LiveModeCamera => ({
    name: "Tor B",
    host: "tor-b.lan",
    kind: "DOORBIRD",
    liveMode,
  });
  // A automatisch besitzt `doorbird` ueber den Host, B ohne eigenen Stream ist aus:
  // A behaelt sein Livebild.
  const byHost: LiveStream[] = [{ name: "doorbird", host: "tor-a.lan" }];
  assert.deepEqual(allowedStreams([doorA(null), doorB("OFF")], byHost), { allowed: ["doorbird"], denied: [] });
  assert.equal(streamAllowed([doorA(null), doorB("OFF")], byHost, "doorbird"), true);
  // Umgekehrt: A aus besitzt `doorbird`, B nur auf Tippen ohne eigenen Stream: gesperrt.
  assert.deepEqual(allowedStreams([doorA("OFF"), doorB("CLICK")], byHost), { allowed: [], denied: ["doorbird"] });
  // Passt `doorbird` zu keinem Host, gehoert er den DoorBirds ohne eigenen Stream.
  const noOwner: LiveStream[] = [
    { name: "tor_a", host: "tor-a.lan" },
    { name: "doorbird", host: "tor-alt.lan" },
  ];
  assert.deepEqual(allowedStreams([doorA(null), doorB("OFF")], noOwner), {
    allowed: ["tor_a"],
    denied: ["doorbird"],
  });
  assert.deepEqual(allowedStreams([doorA("OFF"), doorB(null)], noOwner), {
    allowed: ["doorbird"],
    denied: ["tor_a"],
  });
});

test("Nie erlaubt: Stream einer Kamera mit aus, egal in welcher Schreibweise", () => {
  for (const off of ["OFF", "off", " Off "]) {
    const list: LiveModeCamera[] = [{ name: "Kamera C", host: "kamera-c.lan", liveMode: off }];
    assert.equal(streamAllowed(list, streams, "c_sub"), false, off);
    assert.equal(streamAllowed(list, streams, "c_main"), false, off);
  }
});
