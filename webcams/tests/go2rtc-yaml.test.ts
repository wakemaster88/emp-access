import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGo2rtcYaml,
  existingFfmpegBlock,
  go2rtcApiUrl,
  isValidStreamName,
  yamlKey,
} from "@/lib/go2rtc";
import { ConfigSchema } from "@/lib/types";

const config = ConfigSchema.parse({
  cams: [
    {
      id: "cam-eingang",
      name: "Eingang",
      model: "RLC-811A",
      ip: "192.168.1.51",
      username: "admin",
      password: "p@ss:word",
    },
  ],
  doorbird: { enabled: true, ip: "192.168.1.30", username: "api", password: "pw" },
});

describe("buildGo2rtcYaml", () => {
  const yaml = buildGo2rtcYaml(config);

  it("bindet die API nur an Loopback", () => {
    expect(yaml).toContain('api:\n  listen: "127.0.0.1:1984"\n  origin: "*"\n');
    // Kein Listener auf allen Interfaces.
    expect(yaml).not.toMatch(/listen:\s*"?:1984/);
  });

  it("bindet den RTSP-Server nur an Loopback", () => {
    expect(yaml).toContain('rtsp:\n  listen: "127.0.0.1:8554"\n');
    expect(yaml).not.toMatch(/listen:\s*"?:8554/);
    // Top-Level-Block, nicht eingerückt unter einem anderen.
    expect(yaml).toMatch(/^rtsp:$/m);
  });

  it("lässt die WebRTC-Medien-Einstellungen unverändert", () => {
    expect(yaml).toContain("webrtc:\n  ice_servers: []\n  candidates:\n    - 127.0.0.1:8555\n");
  });

  it("trägt Cam- und Doorbird-Streams weiter ein", () => {
    expect(yaml).toContain("  cam-eingang_main:");
    expect(yaml).toContain("  cam-eingang_sub:");
    expect(yaml).toContain("rtsp://admin:p%40ss%3Aword@192.168.1.51:554/h264Preview_01_sub");
    expect(yaml).toContain("  doorbird:");
  });
});

describe("ffmpeg-Block des Hubs", () => {
  const HUB_BLOCK = "ffmpeg:\n  bin: /opt/homebrew/bin/ffmpeg";

  it("findet den vom Hub angehängten Block am Dateiende", () => {
    const yaml = `${buildGo2rtcYaml(config)}\n${HUB_BLOCK}\n`;
    expect(existingFfmpegBlock(yaml)).toBe(HUB_BLOCK);
  });

  it("endet vor dem nächsten Top-Level-Block und ohne Leerzeilen", () => {
    const yaml = `log:\n  level: info\n\n${HUB_BLOCK}\n  # Pfad vom Hub\n\n# Streams\nstreams:\n  a_sub:\n    - "rtsp://x"\n`;
    expect(existingFfmpegBlock(yaml)).toBe(`${HUB_BLOCK}\n  # Pfad vom Hub`);
  });

  it("liest Schlüssel in Anführungszeichen und einen BOM", () => {
    expect(existingFfmpegBlock(`\uFEFFffmpeg:\n  bin: /x\n`)).toBe("ffmpeg:\n  bin: /x");
    expect(existingFfmpegBlock(`api:\n  listen: ":1984"\n"ffmpeg":\n  bin: /x\n`)).toBe('"ffmpeg":\n  bin: /x');
    expect(existingFfmpegBlock(`'ffmpeg': { bin: /x }\nrtsp:\n`)).toBe("'ffmpeg': { bin: /x }");
  });

  it("zählt eingerückte Zeilen und Stream-Quellen nicht", () => {
    expect(existingFfmpegBlock(buildGo2rtcYaml(config))).toBeNull();
    expect(existingFfmpegBlock(`streams:\n  ffmpeg:\n    - "ffmpeg:a_sub#video=h264"\n`)).toBeNull();
    expect(existingFfmpegBlock("")).toBeNull();
  });

  it("schreibt einen vorhandenen Block unverändert und genau einmal mit", () => {
    const yaml = buildGo2rtcYaml(config, { ffmpeg: HUB_BLOCK });
    expect(yaml.match(/^ffmpeg\s*:/gm)).toHaveLength(1);
    expect(existingFfmpegBlock(yaml)).toBe(HUB_BLOCK);
    // Der Rest bleibt wie ohne Block.
    expect(yaml.replace(`${HUB_BLOCK}\n\n`, "")).toBe(buildGo2rtcYaml(config));
    expect(buildGo2rtcYaml(config, { ffmpeg: null })).toBe(buildGo2rtcYaml(config));
  });
});

describe("writeGo2rtcYaml", () => {
  let dir = "";
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function load(file: string) {
    vi.stubEnv("WEBCAMS_GO2RTC_YAML", file);
    vi.resetModules();
    return import("@/lib/go2rtc");
  }

  it("behält beim Neuschreiben den ffmpeg-Block des Hubs", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "go2rtc-yaml-"));
    const file = path.join(dir, "go2rtc.yaml");
    const mod = await load(file);
    await fs.writeFile(file, `${mod.buildGo2rtcYaml(config)}\nffmpeg:\n  bin: /usr/local/bin/ffmpeg\n`, "utf8");
    await mod.writeGo2rtcYaml(config);
    const out = await fs.readFile(file, "utf8");
    expect(out.match(/^ffmpeg\s*:/gm)).toHaveLength(1);
    expect(out).toContain("ffmpeg:\n  bin: /usr/local/bin/ffmpeg\n");
    expect(out).toMatch(/^rtsp:$/m);
  });

  it("schreibt ohne vorhandene Datei keinen ffmpeg-Block", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "go2rtc-yaml-"));
    const file = path.join(dir, "infra", "go2rtc.yaml");
    const mod = await load(file);
    await mod.writeGo2rtcYaml(config);
    const out = await fs.readFile(file, "utf8");
    expect(out).not.toMatch(/^ffmpeg/m);
    expect(out).toMatch(/^rtsp:$/m);
  });
});

describe("yamlKey", () => {
  it("lässt übliche Stream-Namen unverändert", () => {
    expect(yamlKey("cam-eingang_main")).toBe("cam-eingang_main");
    expect(yamlKey("Cam.Alt_sub")).toBe("Cam.Alt_sub");
  });

  it("schreibt andere Namen als String in einer Zeile", () => {
    expect(yamlKey("alte kamera_main")).toBe('"alte kamera_main"');
    const key = yamlKey("a:\n  b_main");
    expect(key.startsWith('"')).toBe(true);
    expect(key).not.toContain("\n  ");
  });
});

describe("go2rtc-Proxy-Helfer", () => {
  it("akzeptiert die Stream-Namen des Dashboards", () => {
    expect(isValidStreamName("cam-eingang_main")).toBe(true);
    expect(isValidStreamName("cam-eingang_sub")).toBe(true);
    expect(isValidStreamName("doorbird")).toBe(true);
  });

  it("lehnt Namen ab, die die weitergereichte URL verändern könnten", () => {
    for (const bad of ["", "a b", "a/b", "a?b", "a#b", "a&b=c", "x".repeat(121)]) {
      expect(isValidStreamName(bad)).toBe(false);
    }
  });

  it("baut die server-seitige go2rtc-URL", () => {
    expect(go2rtcApiUrl("http://127.0.0.1:1984/", "/api/webrtc?src=a")).toBe(
      "http://127.0.0.1:1984/api/webrtc?src=a",
    );
    // Leere/fehlende Einstellung → Standard-Adresse (Loopback).
    expect(go2rtcApiUrl("", "/api/frame.jpeg?src=a")).toBe(
      "http://127.0.0.1:1984/api/frame.jpeg?src=a",
    );
    expect(go2rtcApiUrl(undefined, "/api/frame.jpeg?src=a")).toBe(
      "http://127.0.0.1:1984/api/frame.jpeg?src=a",
    );
  });
});
