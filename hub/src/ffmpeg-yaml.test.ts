import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiLoopbackAllowed,
  blockListen,
  exposureLine,
  go2rtcExposure,
  go2rtcSetupSwitches,
  hasFfmpegBlock,
  hasTopLevelBlock,
  isLoopbackListen,
  isLoopbackUrl,
  kioskGo2rtcUrl,
  planGo2rtcYaml,
  withFfmpegBin,
  withLoopbackApi,
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

test("API: nicht lokale listen-Zeile bekommt 127.0.0.1, Port und Rest der Datei bleiben", () => {
  const yaml = 'api:\n  listen: ":1984"\n  origin: "*"\n\nlog:\n  level: info\n\nstreams:\n  cam-a_sub: rtsp://x\n';
  const out = withLoopbackApi(yaml);
  assert.equal(out, 'api:\n  listen: "127.0.0.1:1984"\n  origin: "*"\n\nlog:\n  level: info\n\nstreams:\n  cam-a_sub: rtsp://x\n');
  assert.equal(go2rtcExposure(out ?? "").apiLocal, true);
  // Anderer Port und Adresse ohne Anführungszeichen, mit Kommentar.
  assert.equal(withLoopbackApi("api:\n  listen: 0.0.0.0:1985 # alt\n"), 'api:\n  listen: "127.0.0.1:1985"\n');
  // LAN-Adresse, Schlüssel in Anführungszeichen, CRLF und BOM bleiben erhalten.
  assert.equal(withLoopbackApi('\uFEFF"api":\r\n  "listen": "192.168.1.121:1984"\r\nlog:\r\n  level: info\r\n'), '\uFEFF"api":\r\n  "listen": "127.0.0.1:1984"\r\nlog:\r\n  level: info\r\n');
});

test("API: fehlender Block kommt ans Ende, lokale, leere und unklare Fälle bleiben", () => {
  assert.equal(withLoopbackApi("streams:\n  a: rtsp://x\n"), 'streams:\n  a: rtsp://x\n\napi:\n  listen: "127.0.0.1:1984"\n');
  assert.equal(withLoopbackApi('api:\n  listen: "127.0.0.1:1984"\n'), null);
  assert.equal(withLoopbackApi('api:\n  listen: "localhost:1984"\n'), null);
  assert.equal(withLoopbackApi('api:\n  listen: ""\n'), null); // API aus
  assert.equal(withLoopbackApi('api:\n  origin: "*"\n'), null); // Block ohne listen: nicht raten
  assert.equal(withLoopbackApi('api: { listen: ":1984" }\n'), null); // Kurzform: nicht anfassen
  // listen eines anderen Blocks zählt nicht.
  assert.equal(withLoopbackApi('api:\n  origin: "*"\nwebrtc:\n  listen: ":8555"\n'), null);
  // Eingerückte Quelle mit "api:" im Text ist kein Block.
  assert.equal(withLoopbackApi("streams:\n  api: rtsp://x\n"), 'streams:\n  api: rtsp://x\n\napi:\n  listen: "127.0.0.1:1984"\n');
});

test("API nur auf 127.0.0.1, wenn Hub und Kiosk go2rtc lokal ansprechen", () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:1984"), true);
  assert.equal(isLoopbackUrl("http://localhost:1984/"), true);
  assert.equal(isLoopbackUrl("http://[::1]:1984"), false); // API lauscht nur auf 127.0.0.1
  assert.equal(isLoopbackUrl("http://127.0.0.2:1984"), false);
  assert.equal(isLoopbackUrl("http://192.168.1.121:1984"), false);
  assert.equal(isLoopbackUrl("http://imac.local:1984"), false);
  assert.equal(isLoopbackUrl("kein url"), false);
  assert.equal(apiLoopbackAllowed("http://127.0.0.1:1984", undefined), true);
  assert.equal(apiLoopbackAllowed("http://127.0.0.1:1984", "http://localhost:1984"), true);
  assert.equal(apiLoopbackAllowed("http://127.0.0.1:1984", "http://192.168.1.121:1984"), false);
  assert.equal(apiLoopbackAllowed("http://127.0.0.1:1984", null), false);
  assert.equal(apiLoopbackAllowed("http://192.168.1.121:1984", undefined), false);
  assert.equal(kioskGo2rtcUrl('{"settings":{"go2rtcUrl":"http://127.0.0.1:1984"}}'), "http://127.0.0.1:1984");
  assert.equal(kioskGo2rtcUrl('{"settings":{}}'), undefined);
  assert.equal(kioskGo2rtcUrl('{"settings":{"go2rtcUrl":""}}'), undefined);
  assert.equal(kioskGo2rtcUrl('{"settings":{"go2rtcUrl":5}}'), null);
  assert.equal(kioskGo2rtcUrl("{kaputt"), null);
  assert.equal(kioskGo2rtcUrl("null"), null);
});

test("Plan: API nur mit Freigabe, sonst unverändert", () => {
  const yaml = 'api:\n  listen: ":1984"\nrtsp:\n  listen: "127.0.0.1:8554"\n';
  assert.deepEqual(planGo2rtcYaml(yaml, null), { yaml, added: [] });
  assert.deepEqual(planGo2rtcYaml(yaml, null, { apiLoopback: false }), { yaml, added: [] });
  const plan = planGo2rtcYaml(yaml, null, { apiLoopback: true });
  assert.deepEqual(plan.added, ["api"]);
  assert.equal(plan.yaml, 'api:\n  listen: "127.0.0.1:1984"\nrtsp:\n  listen: "127.0.0.1:8554"\n');
  // Zweiter Durchlauf ändert nichts mehr (kein Neustart-Kreislauf).
  assert.deepEqual(planGo2rtcYaml(plan.yaml, null, { apiLoopback: true }), { yaml: plan.yaml, added: [] });
});

test("API: leere, null und ~ heißen für go2rtc :1984 und werden ersetzt, \"\" schaltet aus", () => {
  assert.equal(withLoopbackApi("api:\n  listen:\n  origin: x\n"), 'api:\n  listen: "127.0.0.1:1984"\n  origin: x\n');
  assert.equal(withLoopbackApi("api:\n  listen: null\n"), 'api:\n  listen: "127.0.0.1:1984"\n');
  assert.equal(withLoopbackApi("api:\n  listen: ~ # leer\n"), 'api:\n  listen: "127.0.0.1:1984"\n');
  assert.equal(withLoopbackApi('api:\n  listen: ""\n'), null);
  assert.equal(withLoopbackApi("api:\n  listen: ''\n"), null);
  // Lesen wie go2rtc: leer, null, ~ = Voreinstellung, "" = aus.
  assert.equal(go2rtcExposure("api:\n  listen:\n").api, ":1984");
  assert.equal(go2rtcExposure("api:\n  listen: null\n").apiLocal, false);
  assert.equal(go2rtcExposure('api:\n  listen: ""\n').api, "");
  assert.equal(go2rtcExposure("rtsp:\n  listen: ~\n").rtsp, ":8554");
});

test("API: mehrzeilige und besondere Werte bleiben unangetastet", () => {
  assert.equal(withLoopbackApi("api:\n  listen: >-\n    :1984\n"), null);
  assert.equal(withLoopbackApi("api:\n  listen: |\n    :1984\n"), null);
  assert.equal(withLoopbackApi('api:\n  listen: ":19\n    84"\n'), null);
  assert.equal(withLoopbackApi("api:\n  listen: &l \":1984\"\nwebrtc:\n  listen: *l\n"), null);
  assert.equal(withLoopbackApi("api:\n  listen: !!str :1984\n"), null);
  assert.equal(withLoopbackApi('api:\n  listen: "a\\"b"\n'), null);
  // Wert in der nächsten, tiefer eingerückten Zeile.
  assert.equal(withLoopbackApi("api:\n  listen:\n    \":1984\"\n"), null);
});

test("API: nur listen auf der Ebene des ersten Kinds, Kopf mit Kommentar", () => {
  assert.equal(withLoopbackApi('api:\n  x:\n    listen: ":1"\n  listen: ":1984"\n'), 'api:\n  x:\n    listen: ":1"\n  listen: "127.0.0.1:1984"\n');
  assert.equal(blockListen('api:\n  x:\n    listen: ":1"\n  listen: ":1984"\n', "api"), ":1984");
  assert.equal(withLoopbackApi('api: # Kommentar\n  listen: ":1984"\n'), 'api: # Kommentar\n  listen: "127.0.0.1:1984"\n');
  assert.equal(blockListen('api: # Kommentar\n  listen: "127.0.0.1:1984"\n', "api"), "127.0.0.1:1984");
  // Kinder mit 4 Leerzeichen, Kommentarzeilen dazwischen.
  assert.equal(withLoopbackApi('api:\n    # alt\n    origin: "*"\n    listen: ":1984"\n'), 'api:\n    # alt\n    origin: "*"\n    listen: "127.0.0.1:1984"\n');
});
