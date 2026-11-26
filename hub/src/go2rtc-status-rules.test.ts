import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEBRTC_OK_QUIET_MS,
  WEBRTC_REPEAT_MS,
  browserName,
  browserPlayable,
  clientReport,
  confirmStalls,
  coverageLine,
  hostFromUrl,
  liveProblemLine,
  liveProblems,
  maskUrlAuth,
  repeatNote,
  streamCoverage,
  summarizeStreams,
  watchOkLine,
  webrtcFailureLine,
  webrtcFailureStep,
  webrtcOkStep,
  type StreamSummary,
} from "./go2rtc-status-rules.js";

test("Host ohne Zugangsdaten aus der Quell-URL", () => {
  assert.equal(hostFromUrl("rtsp://admin:geheim@192.168.30.19:554/h264Preview_01_sub"), "192.168.30.19");
  assert.equal(hostFromUrl("rtsp://192.168.30.19/x"), "192.168.30.19");
  assert.equal(hostFromUrl("ffmpeg:abc#video=h264"), null);
});

test("Ruhender Stream: nur URL, kein Format, nicht aktiv", () => {
  const [s] = summarizeStreams({ aquapark_sub: { producers: [{ url: "rtsp://u:p@192.168.30.19:554/sub" }], consumers: [] } });
  assert.equal(s.host, "192.168.30.19");
  assert.equal(s.video, null);
  assert.equal(s.active, false);
  assert.equal(s.consumers, 0);
});

test("Laufender Stream (go2rtc 1.9): Format und Bytes aus receivers", () => {
  const [s] = summarizeStreams({
    shop_sub: {
      producers: [
        {
          url: "rtsp://u:p@192.168.1.198:554/sub",
          remote_addr: "192.168.1.198:554",
          format_name: "rtsp",
          receivers: [
            { codec: { codec_name: "h264", codec_type: "video" }, bytes: 1200, packets: 9 },
            { codec: { codec_name: "aac", codec_type: "audio" }, bytes: 300, packets: 4 },
          ],
        },
      ],
      consumers: [{ format_name: "webrtc" }],
    },
  });
  assert.equal(s.video, "H264");
  assert.equal(s.bytes, 1500);
  assert.equal(s.active, true);
  assert.equal(s.consumers, 1);
});

test("Format aus medias (ältere go2rtc), HEVC wird H265", () => {
  const [s] = summarizeStreams({ halle_sub: { producers: [{ url: "rtsp://u:p@1.2.3.4/x", medias: ["video, recvonly, H265", "audio, recvonly, PCMA/8000"], recv: 10 }] } });
  assert.equal(s.video, "H265");
  assert.equal(browserPlayable(s.video), false);
  assert.equal(browserPlayable("H264"), true);
  assert.equal(browserPlayable(null), null);
});

test("Probleme: Zuschauer ohne Daten, stehende Bytes, H.265 im Sub-Stream", () => {
  const streams = summarizeStreams({
    a_sub: { producers: [{ url: "rtsp://u:p@1.1.1.1/x" }], consumers: [{}] },
    b_sub: { producers: [{ url: "rtsp://u:p@1.1.1.2/x", receivers: [{ codec: { codec_name: "h264", codec_type: "video" }, bytes: 500 }] }], consumers: [{}] },
    c_sub: { producers: [{ url: "rtsp://u:p@1.1.1.3/x", receivers: [{ codec: { codec_name: "h265", codec_type: "video" }, bytes: 900 }] }], consumers: [{}] },
    d_main: { producers: [{ url: "rtsp://u:p@1.1.1.3/y", receivers: [{ codec: { codec_name: "h265", codec_type: "video" }, bytes: 900 }] }], consumers: [] },
  });
  const p = liveProblems(streams, new Map([["b_sub", 500]]));
  assert.deepEqual(p.stalled, ["a_sub", "b_sub"]);
  assert.deepEqual(p.unplayable, ["c_sub (H265)"]);
  assert.match(liveProblemLine(p, streams.length) ?? "", /2\/4 ohne Daten.*a_sub, b_sub.*c_sub \(H265\)/);
  assert.equal(liveProblemLine({ stalled: [], unplayable: [] }, 4), null);
});

test("Kachel-Meldung aus dem Browser: nur feste Felder, sonst verworfen", () => {
  const safari = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  assert.equal(browserName(safari), "Safari");
  const r = clientReport(
    { src: "cam-gastro_sub", event: "ice-timeout", conn: "connecting", ice: "checking", frames: 0, w: 0, h: 0, attempts: 2 },
    safari
  );
  assert.equal(r?.line, "Zentrale (Safari) cam-gastro_sub: ice-timeout – Verbindung connecting, ICE checking, Bilder 0, Größe 0×0, Versuch 2");
  assert.equal(clientReport({ src: "a/../b", event: "x" }, safari), null);
  assert.equal(clientReport({ src: "ok_sub", event: "<script>" }, safari), null);
  assert.match(clientReport({ src: "ok_sub", event: "schwarz", conn: "<b>", paused: true }, "")?.line ?? "", /Verbindung -, .*pausiert$/);
});

const stream = (p: Partial<StreamSummary>): StreamSummary => ({
  name: "x_sub",
  host: "192.168.1.5",
  video: "H264",
  bytes: 1000,
  active: true,
  consumers: 1,
  ...p,
});

test("Fallender Byte-Zähler ist ein Neuaufbau, kein Stillstand", () => {
  // go2rtc hat die RTSP-Verbindung neu aufgebaut und zählt von vorn.
  const p = liveProblems([stream({ name: "cam-eingang_sub", bytes: 120_000 })], new Map([["cam-eingang_sub", 50_000_000]]));
  assert.deepEqual(p.stalled, []);
  // Gleicher Stand wie beim letzten Blick: Verdacht.
  assert.deepEqual(liveProblems([stream({ bytes: 500 })], new Map([["x_sub", 500]])).stalled, ["x_sub"]);
  // Ohne Zuschauer wird nicht geprüft.
  assert.deepEqual(liveProblems([stream({ consumers: 0, active: false, bytes: 0 })], new Map()).stalled, []);
});

test("„ohne Daten“ erst nach zwei Blicken in Folge", () => {
  const one = confirmStalls(["a_sub"], new Map());
  assert.deepEqual(one.stalled, []);
  assert.equal(one.misses.get("a_sub"), 1);
  const two = confirmStalls(["a_sub"], one.misses);
  assert.deepEqual(two.stalled, ["a_sub"]);
  // Liefert der Stream dazwischen Daten, beginnt die Zählung neu.
  const gap = confirmStalls([], two.misses);
  assert.equal(gap.misses.size, 0);
  assert.deepEqual(confirmStalls(["a_sub"], gap.misses).stalled, []);
});

test("Abgleich Kamera und Stream: ohne Stream, ohne Kamera, offline, ruhende Streams", () => {
  const streams = [
    stream({ name: "cam-halle_main", host: "192.168.1.10", consumers: 0, active: false, bytes: 0, video: null }),
    stream({ name: "cam-halle_sub", host: "192.168.1.10" }),
    stream({ name: "cam-alt_main", host: "192.168.1.99", consumers: 0 }),
    stream({ name: "cam-alt_sub", host: "192.168.1.99", consumers: 0 }),
    stream({ name: "cam-aus_sub", host: "192.168.1.20", consumers: 0 }),
    stream({ name: "doorbird", host: "192.168.1.30", consumers: 0 }),
    stream({ name: "mower_a_1_h264", host: null, consumers: 0 }),
  ];
  const cov = streamCoverage(streams, [
    { name: "Halle", host: "192.168.1.10", reachable: true },
    // Neue Adresse, go2rtc kennt nur die alte.
    { name: "Shop", host: "192.168.1.11", reachable: true },
    { name: "Aus", host: "192.168.1.20", reachable: false },
    { name: "Tor", host: "192.168.1.30", reachable: true, kind: "DOORBIRD" },
  ]);
  assert.deepEqual(cov.missing, [{ camera: "Shop", host: "192.168.1.11" }]);
  assert.deepEqual(cov.orphans, [{ host: "192.168.1.99", streams: ["cam-alt_main", "cam-alt_sub"] }]);
  assert.deepEqual(cov.offline, [{ camera: "Aus", streams: ["cam-aus_sub"] }]);
  assert.equal(cov.camerasOffline, 1);
  assert.equal(
    coverageLine(cov),
    "go2rtc: kein Stream für Kamera Shop (Host 192.168.1.11) · Stream ohne Kamera: cam-alt_main, cam-alt_sub (Host 192.168.1.99) · Kamera offline: Aus (cam-aus_sub)"
  );
  // Alles passt: keine Zeile.
  assert.equal(coverageLine(streamCoverage(streams.slice(0, 2), [{ name: "Halle", host: "192.168.1.10", reachable: true }])), null);
});

test("Abgleich: Streams von diesem Rechner (localhost, 127/8) sind keine Streams ohne Kamera", () => {
  const streams = [
    stream({ name: "cam-halle_sub", host: "192.168.1.10" }),
    stream({ name: "mower_a_1", host: "127.0.0.1", consumers: 0 }),
    stream({ name: "mower_a_2", host: "127.0.1.1", consumers: 0 }),
    stream({ name: "relay_x", host: "LocalHost", consumers: 0 }),
    stream({ name: "lan_x", host: "128.0.0.1", consumers: 0 }),
  ];
  const cov = streamCoverage(streams, [{ name: "Halle", host: "192.168.1.10", reachable: true }]);
  assert.deepEqual(cov.orphans, [{ host: "128.0.0.1", streams: ["lan_x"] }]);
  assert.deepEqual([cov.missing, cov.offline], [[], []]);
});

test("DoorBird ohne passenden Host nimmt den Stream doorbird", () => {
  const cov = streamCoverage([stream({ name: "doorbird", host: "192.168.1.31" })], [
    { name: "Tor", host: "192.168.1.30", reachable: true, kind: "DOORBIRD" },
  ]);
  assert.deepEqual([cov.missing, cov.orphans], [[], []]);
});

test("Gutmeldung sagt, was geprüft wurde", () => {
  const streams = [stream({}), stream({ name: "b_sub" }), stream({ name: "c_sub", consumers: 0 })];
  assert.equal(watchOkLine(streams, 2), "go2rtc: alle 2 angesehenen Streams liefern Daten (1 ruht, 2 Kameras offline)");
  assert.equal(watchOkLine(streams.slice(0, 1), 0), "go2rtc: der angesehene Stream liefert Daten (0 ruhen)");
  assert.equal(watchOkLine([stream({ consumers: 0 })], 1), "go2rtc: kein Stream wird gerade angesehen (1 ruht, 1 Kamera offline)");
});

test("Zugangsdaten im Fehlertext von go2rtc werden maskiert", () => {
  const msg = 'streams: dial tcp: rtsp://admin:geheim@192.168.30.19:554/x i/o timeout; "rtsp://u:p@1.2.3.4/y"';
  const masked = maskUrlAuth(msg);
  assert.equal(masked, 'streams: dial tcp: rtsp://***@192.168.30.19:554/x i/o timeout; "rtsp://***@1.2.3.4/y"');
  assert.ok(!masked.includes("geheim"));
  // Ohne Zugangsdaten unverändert.
  assert.equal(maskUrlAuth("rtsp://192.168.1.5/x host is down"), "rtsp://192.168.1.5/x host is down");
});

test("Maskierung: Passwort mit / oder @ und Zugangsdaten als Parameter", () => {
  // Unkodiertes / im Passwort: alles bis zum letzten @ vor dem Host (gilt für jedes Schema).
  assert.equal(maskUrlAuth("http://admin:ge/he/im@192.168.1.5:554/x timeout"), "http://***@192.168.1.5:554/x timeout");
  assert.equal(maskUrlAuth("doorbird://admin:a@b/c@192.168.1.30"), "doorbird://***@192.168.1.30");
  // Zwei URLs, durch Leerzeichen oder Anführungszeichen getrennt, je für sich.
  assert.equal(maskUrlAuth('"rtsp://u:p@h1/x","rtsp://u:PW@h2/y"'), '"rtsp://***@h1/x","rtsp://***@h2/y"');
  // Parameter in der Quell-URL, Groß- und Kleinschreibung egal.
  assert.equal(
    maskUrlAuth("http://192.168.1.30/bha-api/video.cgi?user=api&password=geheim&channel=1 host is down"),
    "http://192.168.1.30/bha-api/video.cgi?user=***&password=***&channel=1 host is down"
  );
  assert.equal(maskUrlAuth("x?USERNAME=a&Pass=b&pwd=c&token=d&api_key=e"), "x?USERNAME=***&Pass=***&pwd=***&token=***&api_key=***");
  assert.equal(maskUrlAuth("user=admin"), "user=***");
  assert.equal(maskUrlAuth('{"url":"x?key=abc"}'), '{"url":"x?key=***"}');
  // Andere Parameter und ähnliche Namen bleiben.
  assert.equal(maskUrlAuth("x?channel=1&monkey=2&passes=3"), "x?channel=1&monkey=2&passes=3");
});

test("WebRTC-Fehler: erste Zeile sofort, danach höchstens stündlich eine Sammelzeile", () => {
  const t0 = Date.UTC(2026, 10, 22, 11, 58);
  let st = webrtcFailureStep(undefined, t0);
  assert.equal(st.log, "first");
  assert.equal(webrtcFailureLine("cam-a_sub", "HTTP 500 i/o timeout", "first", st.next), "go2rtc WebRTC cam-a_sub: HTTP 500 i/o timeout");
  // Alle 15 s ein neuer Versuch mit wechselndem Text: kein Log bis zur vollen Stunde.
  let logged = 0;
  for (let t = t0 + 15_000; t < t0 + WEBRTC_REPEAT_MS; t += 15_000) {
    st = webrtcFailureStep(st.next, t);
    if (st.log) logged++;
  }
  assert.equal(logged, 0);
  st = webrtcFailureStep(st.next, t0 + WEBRTC_REPEAT_MS);
  assert.equal(st.log, "repeat");
  assert.equal(st.next.count, 241);
  assert.equal(
    webrtcFailureLine("cam-a_sub", "HTTP 500 host is down", "repeat", st.next),
    "go2rtc WebRTC cam-a_sub: weiter ohne Bild (241 Versuche seit 12:58), zuletzt HTTP 500 host is down"
  );
  assert.equal(repeatNote(st.next), "241 Meldungen seit 12:58");
  // Über eine Stunde kein Versuch (Zentrale zu): neue Zählung, Zeile sofort.
  const later = webrtcFailureStep(st.next, t0 + 3 * WEBRTC_REPEAT_MS);
  assert.equal(later.log, "first");
  assert.equal(later.next.count, 1);
});

test("WebRTC-Fehler ohne Pause über Stunden: eine Zählung ab dem ersten Fehler", () => {
  // Maßgeblich ist der letzte Versuch, nicht der erste: zwei Stunden lang alle 15 s.
  const t0 = Date.UTC(2026, 10, 22, 11, 58);
  let st = webrtcFailureStep(undefined, t0);
  const kinds: string[] = [];
  for (let t = t0 + 15_000; t <= t0 + 2 * WEBRTC_REPEAT_MS + 15_000; t += 15_000) {
    st = webrtcFailureStep(st.next, t);
    if (st.log) kinds.push(st.log);
  }
  assert.deepEqual(kinds, ["repeat", "repeat"]);
  assert.equal(st.next.firstAt, t0);
  assert.equal(st.next.count, 2 * 240 + 2);
  assert.equal(repeatNote(st.next), "482 Meldungen seit 12:58");
});

test("Erfolg löst die Drossel erst nach 10 min ohne Fehlschlag", () => {
  const t0 = Date.UTC(2026, 10, 22, 11, 58);
  assert.equal(webrtcOkStep(undefined, t0), undefined);
  const st = webrtcFailureStep(undefined, t0).next;
  // Kurz nach dem Fehler: Zählung bleibt, Beginn der Zeit mit Bild gemerkt.
  assert.equal(webrtcOkStep(st, t0 + 30_000)?.okAt, t0 + 30_000);
  assert.equal(webrtcOkStep(st, t0 + WEBRTC_OK_QUIET_MS - 1)?.count, 1);
  assert.equal(webrtcOkStep(st, t0 + WEBRTC_OK_QUIET_MS), undefined);
  assert.equal(WEBRTC_OK_QUIET_MS, 10 * 60_000);
  // Ein weiterer Erfolg verschiebt den Beginn nicht.
  const up = webrtcOkStep(st, t0 + 30_000);
  assert.equal(webrtcOkStep(up, t0 + 90_000)?.okAt, t0 + 30_000);

  // Flatternde Kamera: abwechselnd Fehler und Erfolg alle 30 s über eine Stunde.
  let state: ReturnType<typeof webrtcFailureStep>["next"] | undefined;
  const lines: string[] = [];
  for (let t = t0; t < t0 + WEBRTC_REPEAT_MS; t += 60_000) {
    const step = webrtcFailureStep(state, t);
    state = step.next;
    if (step.log) lines.push(step.log);
    state = webrtcOkStep(state, t + 30_000);
  }
  assert.deepEqual(lines, ["first"]);
  // Nach 10 min Ruhe löst ein Erfolg, der nächste Fehler kommt sofort.
  const quiet = webrtcFailureStep(undefined, t0).next;
  assert.equal(webrtcFailureStep(webrtcOkStep(quiet, t0 + WEBRTC_OK_QUIET_MS), t0 + WEBRTC_OK_QUIET_MS + 1000).log, "first");
});

test("Neue Störung nach mindestens 10 min mit Bild kommt sofort ins Log", () => {
  // Fehler 12:00, Bild ab 12:01, neue Störung 12:25 bis 12:50 alle 15 s.
  const t0 = Date.UTC(2026, 10, 22, 11, 0);
  let state: ReturnType<typeof webrtcFailureStep>["next"] | undefined = webrtcFailureStep(undefined, t0).next;
  state = webrtcOkStep(state, t0 + 60_000);
  const kinds: string[] = [];
  for (let t = t0 + 25 * 60_000; t <= t0 + 50 * 60_000; t += 15_000) {
    const step = webrtcFailureStep(state, t);
    state = step.next;
    if (step.log) kinds.push(step.log);
  }
  assert.deepEqual(kinds, ["first"]);
  assert.equal(state?.firstAt, t0 + 25 * 60_000);
  assert.equal(state?.okAt, undefined);
  // Bild nur 9 min lang: dieselbe Störung, keine neue erste Zeile.
  let s2: ReturnType<typeof webrtcFailureStep>["next"] | undefined = webrtcFailureStep(undefined, t0).next;
  s2 = webrtcOkStep(s2, t0 + 60_000);
  assert.equal(webrtcFailureStep(s2, t0 + 10 * 60_000 - 1).log, null);
  assert.equal(webrtcFailureStep(s2, t0 + 11 * 60_000).log, "first");
});

test("Kachel-Meldung mit Aufbauzeit und Kandidat der Gegenseite", () => {
  const safari = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const r = clientReport(
    {
      src: "cam-a_sub",
      event: "ice-timeout",
      conn: "connecting",
      ice: "checking",
      attempts: 0,
      ms: 6012,
      candType: "host",
      candAddr: "192.168.1.121",
      candPort: 8555,
      candState: "in-progress",
    },
    safari
  );
  assert.equal(
    r?.line,
    "Zentrale (Safari) cam-a_sub: ice-timeout – Verbindung connecting, ICE checking, Bilder 0, Größe 0×0, Versuch 0, Aufbau 6,0 s, Kandidat host 192.168.1.121:8555 in-progress"
  );
  // Nur feste Muster: unbekannter Typ, Adresse mit Fremdtext, Port außerhalb, zu lange Dauer fallen weg.
  const bad = clientReport(
    { src: "cam-a_sub", event: "abbruch", ms: 9e9, candType: "<b>", candAddr: "1.2.3.4 x", candPort: 70000, candState: "x" },
    safari
  );
  assert.ok(bad && !/Aufbau|Kandidat/.test(bad.line));
  const v6 = clientReport({ src: "cam-a_sub", event: "abbruch", candType: "host", candAddr: "fe80::1", candPort: 8555 }, safari);
  assert.match(v6?.line ?? "", /Kandidat host \[fe80::1\]:8555$/);
  const noAddr = clientReport({ src: "cam-a_sub", event: "abbruch", candType: "srflx", candAddr: "999.1.1.1" }, safari);
  assert.match(noAddr?.line ?? "", /Kandidat srflx$/);
});

test("Kachel-Meldung: Grenzen für Aufbauzeit und Port", () => {
  const line = (extra: Record<string, unknown>) => clientReport({ src: "cam-a_sub", event: "abbruch", ...extra }, "")?.line ?? "";
  // Aufbauzeit: über 0 bis einschließlich 10 min.
  for (const ms of [0, -5, 600_001, Number.NaN, "6000"]) assert.ok(!/Aufbau/.test(line({ ms })), String(ms));
  assert.match(line({ ms: 1 }), /Aufbau 0,0 s$/);
  assert.match(line({ ms: 600_000 }), /Aufbau 600,0 s$/);
  // Port: 1 bis 65535, sonst nur die Adresse.
  const cand = (candPort: unknown) => line({ candType: "host", candAddr: "192.168.1.121", candPort });
  assert.match(cand(70000), /Kandidat host 192\.168\.1\.121$/);
  assert.match(cand(65536), /Kandidat host 192\.168\.1\.121$/);
  assert.match(cand(0), /Kandidat host 192\.168\.1\.121$/);
  assert.match(cand(8555.5), /Kandidat host 192\.168\.1\.121$/);
  assert.match(cand(65535), /Kandidat host 192\.168\.1\.121:65535$/);
  assert.match(cand(1), /Kandidat host 192\.168\.1\.121:1$/);
});
