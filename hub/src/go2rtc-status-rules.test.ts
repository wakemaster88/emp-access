import { test } from "node:test";
import assert from "node:assert/strict";
import { browserName, browserPlayable, clientReport, hostFromUrl, liveProblemLine, liveProblems, summarizeStreams } from "./go2rtc-status-rules.js";

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
