import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockListen,
  exposureLine,
  go2rtcExposure,
  go2rtcSetupSwitches,
  hasFfmpegBlock,
  hasTopLevelBlock,
  isLoopbackListen,
  planGo2rtcYaml,
  withFfmpegBin,
  withLoopbackRtsp,
} from "./ffmpeg-yaml.js";

test("ffmpeg.bin wird angehängt, wenn kein ffmpeg-Block existiert", () => {
  const yaml = "streams:\n  cam1: rtsp://x\n";
  const out = withFfmpegBin(yaml, "/usr/local/bin/ffmpeg");
  assert.equal(out, "streams:\n  cam1: rtsp://x\n\nffmpeg:\n  bin: /usr/local/bin/ffmpeg\n");
  assert.ok(hasFfmpegBlock(out));
});

test("vorhandener ffmpeg-Block bleibt unverändert", () => {
  const yaml = "ffmpeg:\n  bin: /opt/ffmpeg\nstreams: {}\n";
  assert.equal(withFfmpegBin(yaml, "/usr/local/bin/ffmpeg"), yaml);
});

test("eingerückte ffmpeg-Quelle zählt nicht als Block", () => {
  const yaml = "streams:\n  cam: ffmpeg:rtsp://x#video=h264\n";
  assert.ok(!hasFfmpegBlock(yaml));
});

test("RTSP-Block wird angehängt, wenn keiner existiert", () => {
  const yaml = 'api:\n  listen: "127.0.0.1:1984"\n\nstreams:\n  cam-a_sub:\n    - "rtsp://u:p@192.168.1.5:554/sub"\n';
  const out = withLoopbackRtsp(yaml);
  assert.equal(out, `${yaml}\nrtsp:\n  listen: "127.0.0.1:8554"\n`);
  assert.ok(hasTopLevelBlock(out, "rtsp"));
  // Zweiter Aufruf ändert nichts mehr.
  assert.equal(withLoopbackRtsp(out), out);
});

test("vorhandener RTSP-Block bleibt unverändert", () => {
  const yaml = 'rtsp:\n  listen: ":8554"\nstreams: {}\n';
  assert.equal(withLoopbackRtsp(yaml), yaml);
});

test("eingerückte rtsp-Quelle zählt nicht als Block", () => {
  const yaml = 'streams:\n  cam-a_main:\n    - "rtsp://u:p@192.168.1.5:554/main"\n  cam-b: rtsp://192.168.1.6/x\n';
  assert.ok(!hasTopLevelBlock(yaml, "rtsp"));
  assert.match(withLoopbackRtsp(yaml), /\nrtsp:\n  listen: "127\.0\.0\.1:8554"\n$/);
});

test("ffmpeg und RTSP in einem Zug, nichts zu tun heißt gleiche Datei", () => {
  const yaml = "streams:\n  cam1: rtsp://x\n";
  const plan = planGo2rtcYaml(yaml, "/opt/homebrew/bin/ffmpeg");
  assert.deepEqual(plan.added, ["ffmpeg", "rtsp"]);
  assert.equal(plan.yaml, `${yaml}\nffmpeg:\n  bin: /opt/homebrew/bin/ffmpeg\n\nrtsp:\n  listen: "127.0.0.1:8554"\n`);
  assert.deepEqual(planGo2rtcYaml(plan.yaml, "/opt/homebrew/bin/ffmpeg"), { yaml: plan.yaml, added: [] });
  // Ohne bekannten ffmpeg-Pfad nur RTSP.
  assert.deepEqual(planGo2rtcYaml(yaml, null).added, ["rtsp"]);
});

test("Lausch-Adressen: offen, lokal, fehlender Block", () => {
  const local = go2rtcExposure('api:\n  tls_listen: ":8443"\n  listen: "127.0.0.1:1984"\nrtsp:\n  listen: "127.0.0.1:8554" # nur lokal\n');
  assert.deepEqual(local, { api: "127.0.0.1:1984", rtsp: "127.0.0.1:8554", apiLocal: true, rtspLocal: true });
  assert.equal(exposureLine(local), "go2rtc: API 127.0.0.1:1984, RTSP 127.0.0.1:8554");

  const open = go2rtcExposure('api:\n  listen: "127.0.0.1:1984"\nrtsp:\n  listen: ":8554"\n');
  assert.equal(open.rtsp, ":8554");
  assert.equal(open.rtspLocal, false);

  // Fehlender Block: Voreinstellung von go2rtc, alle Schnittstellen.
  const missing = go2rtcExposure("streams:\n  a: rtsp://u:p@1.2.3.4/x\n");
  assert.deepEqual(missing, { api: ":1984", rtsp: ":8554", apiLocal: false, rtspLocal: false });

  // Block ohne listen gilt ebenso; leeres listen schaltet den Server ab.
  assert.equal(go2rtcExposure("rtsp:\n  username: x\n").rtspLocal, false);
  const off = go2rtcExposure('rtsp:\n  listen: ""\n');
  assert.equal(off.rtspLocal, true);
  assert.match(exposureLine(off), /RTSP aus$/);
  // Kurzform und Adresse im LAN.
  assert.equal(go2rtcExposure('rtsp: { listen: "127.0.0.1:8554" }\n').rtsp, "127.0.0.1:8554");
  assert.equal(go2rtcExposure("rtsp:\n  listen: 192.168.1.10:8554\n").rtspLocal, false);
  assert.equal(go2rtcExposure("rtsp:\n  listen: 0.0.0.0:8554\n").rtspLocal, false);
  assert.equal(go2rtcExposure("rtsp:\n  listen: localhost:8554\n").rtspLocal, true);
  // Ein listen unter einem anderen Block zählt nicht.
  assert.equal(blockListen('webrtc:\n  listen: ":8555"\nrtsp:\n  username: x\n', "rtsp"), null);
});

test("isLoopbackListen", () => {
  assert.ok(isLoopbackListen("127.0.0.1:8554"));
  assert.ok(isLoopbackListen("[::1]:8554"));
  assert.ok(isLoopbackListen(""));
  assert.ok(!isLoopbackListen(":8554"));
  assert.ok(!isLoopbackListen("[::]:8554"));
  // Ganz 127/8 ist Loopback, 128.x nicht.
  assert.ok(isLoopbackListen("127.0.0.2:8554"));
  assert.ok(isLoopbackListen("127.1.2.3"));
  assert.ok(!isLoopbackListen("128.0.0.1:8554"));
  assert.ok(!isLoopbackListen("10.127.0.1:8554"));
});

test("Top-Level-Schlüssel in Anführungszeichen und mit BOM zählen", () => {
  for (const yaml of ['"rtsp":\n  listen: ":8554"\n', "'rtsp':\n  listen: \":8554\"\n", '\uFEFFrtsp:\n  listen: ":8554"\n']) {
    assert.ok(hasTopLevelBlock(yaml, "rtsp"), JSON.stringify(yaml));
    assert.equal(withLoopbackRtsp(yaml), yaml, "kein zweiter rtsp-Block");
    assert.deepEqual(planGo2rtcYaml(yaml, null).added, []);
    assert.equal(blockListen(yaml, "rtsp"), ":8554");
  }
  for (const yaml of ['"ffmpeg":\n  bin: /x\n', "'ffmpeg':\n  bin: /x\n", "\uFEFFffmpeg:\n  bin: /x\n"]) {
    assert.ok(hasFfmpegBlock(yaml), JSON.stringify(yaml));
    assert.equal(withFfmpegBin(yaml, "/y"), yaml, "kein zweiter ffmpeg-Block");
  }
  // BOM vor einem anderen ersten Block: rtsp weiter unten wird gefunden, api ebenso.
  const bom = '\uFEFFapi:\n  listen: "127.0.0.1:1984"\nrtsp:\n  "listen": "127.0.0.1:8554"\n';
  assert.deepEqual(go2rtcExposure(bom), { api: "127.0.0.1:1984", rtsp: "127.0.0.1:8554", apiLocal: true, rtspLocal: true });
  assert.equal(blockListen("\"rtsp\": { 'listen': \"127.0.0.1:8554\" }\n", "rtsp"), "127.0.0.1:8554");
  // Ähnliche Namen zählen nicht.
  assert.ok(!hasTopLevelBlock('"rtsp2":\n  listen: ":1"\nrtsp_x: 1\n', "rtsp"));
});

test("listen: Block ohne listen, danach ein anderer Block mit listen", () => {
  const yaml = 'rtsp:\n  username: x\napi:\n  listen: "127.0.0.1:1984"\n';
  assert.equal(blockListen(yaml, "rtsp"), null);
  assert.equal(blockListen(yaml, "api"), "127.0.0.1:1984");
  assert.deepEqual(go2rtcExposure(yaml), { api: "127.0.0.1:1984", rtsp: ":8554", apiLocal: true, rtspLocal: false });
  // Kommentarzeile am Zeilenanfang beendet den Block nicht.
  assert.equal(blockListen('rtsp:\n# lokal\n  listen: "127.0.0.1:8554"\n', "rtsp"), "127.0.0.1:8554");
});

test("listen ohne Anführungszeichen: Kommentar am Zeilenende fällt weg", () => {
  assert.equal(blockListen("rtsp:\n  listen: 127.0.0.1:8554 # nur lokal\n", "rtsp"), "127.0.0.1:8554");
  assert.equal(blockListen("rtsp:\n  listen: :8554   # alle\n", "rtsp"), ":8554");
  assert.equal(go2rtcExposure("rtsp:\n  listen: 127.0.0.1:8554 # x\n").rtspLocal, true);
  // In Anführungszeichen gehört ein # zum Wert.
  assert.equal(blockListen('rtsp:\n  listen: "a #b"\n', "rtsp"), "a #b");
});

test("go2rtc-Einrichtung: nur macOS, zwei getrennte Schalter", () => {
  assert.deepEqual(go2rtcSetupSwitches("linux", {}), { ffmpeg: false, yaml: false });
  assert.deepEqual(go2rtcSetupSwitches("win32", { HUB_FFMPEG_SETUP: "1" }), { ffmpeg: false, yaml: false });
  assert.deepEqual(go2rtcSetupSwitches("darwin", {}), { ffmpeg: true, yaml: true });
  assert.deepEqual(go2rtcSetupSwitches("darwin", { HUB_FFMPEG_SETUP: "0" }), { ffmpeg: false, yaml: true });
  assert.deepEqual(go2rtcSetupSwitches("darwin", { HUB_GO2RTC_YAML: "0" }), { ffmpeg: true, yaml: false });
  assert.deepEqual(go2rtcSetupSwitches("darwin", { HUB_FFMPEG_SETUP: "0", HUB_GO2RTC_YAML: "0" }), { ffmpeg: false, yaml: false });
});
