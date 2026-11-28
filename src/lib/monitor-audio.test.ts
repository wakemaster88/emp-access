import assert from "node:assert/strict";
import { test } from "node:test";
import { isMonitorAudioType, zonePlayerOnline } from "./audio-constants";
import {
  MonitorJobQueue,
  chimeWav,
  decisionFromSearch,
  elementVolume,
  interruptsSpeech,
  jobNeedsSound,
  musicBlocked,
  parseAnnounce,
  parseDecision,
  parsePlay,
  pcm16ToFloat32,
  playOrder,
  silentWav,
  zoneSource,
  type MonitorZoneState,
} from "./monitor-audio";

const NOW = Date.parse("2026-11-28T12:00:00Z");

function zone(patch: Partial<MonitorZoneState> = {}): MonitorZoneState {
  return {
    id: 5,
    name: "Shop",
    isActive: true,
    volume: 50,
    announcementVolume: 85,
    duckVolume: 15,
    sourceKind: "SILENCE",
    streamUrl: null,
    music: null,
    playlist: null,
    ...patch,
  };
}

test("musicBlocked: ohne Fenster ist Musik erlaubt", () => {
  assert.equal(musicBlocked(zone(), NOW), false);
  assert.equal(musicBlocked(zone({ music: { allowed: true, until: null } }), NOW), false);
  assert.equal(musicBlocked(zone({ music: { allowed: false, until: null } }), NOW), true);
});

test("musicBlocked: nach `until` gilt das Gegenteil (wie am Pi)", () => {
  const before = "2026-11-28T11:59:00Z";
  const after = "2026-11-28T12:30:00Z";
  assert.equal(musicBlocked(zone({ music: { allowed: true, until: before } }), NOW), true);
  assert.equal(musicBlocked(zone({ music: { allowed: true, until: after } }), NOW), false);
  assert.equal(musicBlocked(zone({ music: { allowed: false, until: before } }), NOW), false);
});

test("Warteschlange: Notfall zuerst, sonst Reihenfolge, keine Doppel", () => {
  const queue = new MonitorJobQueue();
  assert.equal(queue.push({ id: 1, kind: "ANNOUNCE", payload: { priority: 0 } }), true);
  assert.equal(queue.push({ id: 2, kind: "PLAY", payload: {} }), true);
  assert.equal(queue.push({ id: 3, kind: "ANNOUNCE", payload: { priority: 100 } }), true);
  assert.equal(queue.push({ id: 1, kind: "ANNOUNCE", payload: { priority: 0 } }), false);
  assert.deepEqual(
    [queue.pop()?.id, queue.pop()?.id, queue.pop()?.id, queue.pop()],
    [3, 1, 2, null]
  );
});

test("Notfall unterbricht Durchsagen; Ton brauchen nur Durchsage, Live und Start", () => {
  assert.equal(interruptsSpeech({ id: 1, kind: "ANNOUNCE", payload: { priority: 100 } }), true);
  assert.equal(interruptsSpeech({ id: 1, kind: "LIVE", payload: { priority: 100 } }), true);
  assert.equal(interruptsSpeech({ id: 1, kind: "ANNOUNCE", payload: { priority: 10 } }), false);
  assert.equal(interruptsSpeech({ id: 1, kind: "PLAY", payload: { priority: 100 } }), false);
  assert.deepEqual(
    ["ANNOUNCE", "LIVE", "PLAY", "STOP", "VOLUME", "SYNC_LIBRARY"].map(jobNeedsSound),
    [true, true, true, false, false, false]
  );
});

test("parseAnnounce: Gong, Wiederholung, Musik darunter wie am Pi begrenzt", () => {
  assert.deepEqual(parseAnnounce({}), { error: "Durchsage ohne Audiodatei" });
  assert.deepEqual(parseAnnounce({ url: "https://x/a.mp3", chime: true, repeat: 2 }), {
    url: "https://x/a.mp3",
    chime: true,
    repeat: 2,
    bed: null,
  });
  const withBed = parseAnnounce({ url: "u", bed: { url: "b", untilSec: 120, level: 3 } });
  assert.ok(!("error" in withBed));
  assert.deepEqual(withBed.bed, { url: "b", untilSec: 60, level: 1 });
  const short = parseAnnounce({ url: "u", bed: { url: "b", untilSec: 1 } });
  assert.ok(!("error" in short));
  assert.deepEqual(short.bed, { url: "b", untilSec: 4, level: 0.8 });
  const noBed = parseAnnounce({ url: "u", repeat: 0, bed: { url: "b", untilSec: 0 } });
  assert.ok(!("error" in noBed));
  assert.equal(noBed.bed, null);
  assert.equal(noBed.repeat, 1);
});

test("parsePlay: Webradio, Playlist, Fehler und manueller Vorrang", () => {
  assert.deepEqual(parsePlay({ kind: "STREAM", url: "https://radio", volume: 40, manual: true }), {
    source: { kind: "STREAM", url: "https://radio" },
    volume: 40,
    manual: true,
  });
  assert.deepEqual(parsePlay({ kind: "STREAM" }), { error: "Stream ohne URL" });
  assert.deepEqual(parsePlay({ kind: "PLAYLIST", tracks: [] }), {
    error: "Keine abspielbaren Titel in der Playlist",
  });
  const playlist = parsePlay({
    kind: "PLAYLIST",
    shuffle: true,
    tracks: [{ id: 1, title: "A", url: "a.mp3" }, { title: "ohne URL" }],
  });
  assert.ok(!("error" in playlist));
  assert.equal(playlist.manual, false);
  assert.equal(playlist.volume, null);
  assert.deepEqual(playlist.source, { kind: "PLAYLIST", shuffle: true, tracks: [{ id: 1, title: "A", url: "a.mp3" }] });
});

test("zoneSource: was nach dem Laden weiterläuft", () => {
  assert.equal(zoneSource(zone()), null);
  assert.deepEqual(zoneSource(zone({ sourceKind: "STREAM", streamUrl: "https://r" })), {
    kind: "STREAM",
    url: "https://r",
  });
  assert.equal(zoneSource(zone({ sourceKind: "STREAM", streamUrl: null })), null);
  assert.deepEqual(
    zoneSource(
      zone({
        sourceKind: "PLAYLIST",
        playlist: { id: 1, name: "P", shuffle: false, tracks: [{ title: "A", url: "a" }] },
      })
    ),
    { kind: "PLAYLIST", shuffle: false, tracks: [{ id: undefined, title: "A", url: "a" }] }
  );
});

test("playOrder: der Reihe nach oder gemischt, jeder Titel genau einmal", () => {
  assert.deepEqual(playOrder(4, false), [0, 1, 2, 3]);
  const mixed = playOrder(4, true, () => 0);
  assert.deepEqual([...mixed].sort(), [0, 1, 2, 3]);
  assert.notDeepEqual(mixed, [0, 1, 2, 3]);
});

test("Wahl je Gerät: Link-Parameter und gespeicherter Wert", () => {
  assert.equal(decisionFromSearch("?ton=an"), "on");
  assert.equal(decisionFromSearch("?x=1&ton=AUS"), "off");
  assert.equal(decisionFromSearch("?ton=vielleicht"), null);
  assert.equal(decisionFromSearch(""), null);
  assert.equal(parseDecision("on"), "on");
  assert.equal(parseDecision("off"), "off");
  assert.equal(parseDecision(null), null);
  assert.equal(parseDecision("ja"), null);
});

test("elementVolume begrenzt auf 0–1", () => {
  assert.equal(elementVolume(50), 0.5);
  assert.equal(elementVolume(150), 1);
  assert.equal(elementVolume(-5), 0);
  assert.equal(elementVolume(Number.NaN), 0);
});

test("pcm16ToFloat32: 16 Bit little-endian", () => {
  const bytes = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x01]);
  const samples = pcm16ToFloat32(bytes);
  assert.equal(samples.length, 3);
  assert.equal(samples[0], 0);
  assert.ok(Math.abs(samples[1] - 32767 / 32768) < 1e-9);
  assert.equal(samples[2], -1);
});

test("Gong und Stille sind gültige WAV-Dateien", () => {
  for (const wav of [chimeWav(), silentWav()]) {
    const text = String.fromCharCode(...wav.slice(0, 4)) + String.fromCharCode(...wav.slice(8, 12));
    assert.equal(text, "RIFFWAVE");
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(view.getUint32(40, true), wav.byteLength - 44);
  }
  // Zweiklang 0,28 s + 0,45 s bei 44,1 kHz.
  assert.equal(chimeWav().byteLength, 44 + (Math.floor(44_100 * 0.28) + Math.floor(44_100 * 0.45)) * 2);
});

test("zonePlayerOnline: Pi über das Gerät, Monitor über den Heartbeat der Zone", () => {
  const fresh = new Date(Date.now() - 30_000);
  const stale = new Date(Date.now() - 10 * 60_000);
  assert.equal(zonePlayerOnline({ device: { lastUpdate: fresh } }), true);
  assert.equal(zonePlayerOnline({ device: { lastUpdate: stale }, monitorId: 3, lastStateAt: fresh }), false);
  assert.equal(zonePlayerOnline({ device: null, monitorId: 3, lastStateAt: fresh }), true);
  assert.equal(zonePlayerOnline({ device: null, monitorId: 3, lastStateAt: stale }), false);
  assert.equal(zonePlayerOnline({ device: null, monitorId: null, lastStateAt: fresh }), false);
});

test("Nur dauerhaft laufende Monitore können eine Zone spielen", () => {
  assert.equal(isMonitorAudioType("CHECKIN"), true);
  assert.equal(isMonitorAudioType("MONITOR"), true);
  assert.equal(isMonitorAudioType("RESOURCE_MONITOR"), true);
  assert.equal(isMonitorAudioType("SCANNER"), false);
  assert.equal(isMonitorAudioType("VOUCHER"), false);
});
