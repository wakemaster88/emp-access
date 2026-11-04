import { test } from "node:test";
import assert from "node:assert/strict";
import { isMowerStream, mowerStreamName, mowerStreamSources, needsStreamUpdate } from "./mower-streams.js";

test("Stream-Namen passen zum Dashboard-Filter und sind eindeutig je Kamera", () => {
  assert.equal(mowerStreamName("Luba-VA6C39PZ", 1), "mower_luba_va6c39pz_1");
  assert.equal(mowerStreamName("Luba-VSG3QASL", 2), "mower_luba_vsg3qasl_2");
  assert.match(mowerStreamName("Luba-VA6C39PZ", 1), /^[\w.-]{1,80}$/);
  assert.ok(isMowerStream("mower_luba_va6c39pz_1_h264"));
  assert.ok(!isMowerStream("eingang_sub"));
});

test("Quellen: WHEP zum Mäher-Dienst plus H264 über ffmpeg", () => {
  const s = mowerStreamSources("Luba-VA6C39PZ", 1, 8791);
  assert.deepEqual(Object.keys(s), ["mower_luba_va6c39pz_1", "mower_luba_va6c39pz_1_h264"]);
  assert.equal(s.mower_luba_va6c39pz_1, "webrtc:http://127.0.0.1:8791/whep/Luba-VA6C39PZ/1?stream=mower_luba_va6c39pz_1");
  assert.equal(s.mower_luba_va6c39pz_1_h264, "ffmpeg:mower_luba_va6c39pz_1#video=h264#hardware");
  for (const src of Object.values(s)) assert.ok(!/\s/.test(src), "go2rtc lehnt Quellen mit Leerzeichen ab");
});

test("Eintragen nur, wenn er fehlt oder abweicht, nie während jemand zuschaut", () => {
  const src = "webrtc:http://127.0.0.1:8791/whep/Luba-VA6C39PZ/1?stream=mower_luba_va6c39pz_1";
  assert.equal(needsStreamUpdate(undefined, src), true);
  assert.equal(needsStreamUpdate({ producers: [{ url: src }], consumers: [] }, src), false);
  assert.equal(needsStreamUpdate({ producers: [{ url: src.replace("8791", "8792") }], consumers: null }, src), true);
  // laufend: go2rtc zeigt die URL der Verbindung, und es schaut jemand zu
  assert.equal(needsStreamUpdate({ producers: [{ url: "http://127.0.0.1:8791/whep/x/1" }], consumers: [{}] }, src), false);
  assert.equal(needsStreamUpdate({ producers: [{ url: src.slice("webrtc:".length) }], consumers: [] }, src), false);
  assert.equal(needsStreamUpdate({ producers: [], consumers: [] }, src), true);
});
