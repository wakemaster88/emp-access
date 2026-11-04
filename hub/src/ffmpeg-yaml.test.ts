import { test } from "node:test";
import assert from "node:assert/strict";
import { hasFfmpegBlock, withFfmpegBin } from "./ffmpeg-yaml.js";

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
