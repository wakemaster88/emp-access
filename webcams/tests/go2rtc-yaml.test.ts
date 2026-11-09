import { describe, expect, it } from "vitest";
import { buildGo2rtcYaml, go2rtcApiUrl, isValidStreamName } from "@/lib/go2rtc";
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
