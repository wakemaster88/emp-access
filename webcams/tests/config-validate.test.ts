import { describe, expect, it } from "vitest";
import {
  camWriteErrors,
  configWriteErrors,
  doorbirdWriteErrors,
  isConfigId,
  isHttpUrl,
  isIpAddress,
  settingsWriteErrors,
  widgetWriteErrors,
} from "@/lib/config-validate";
import { clampConfigId } from "@/lib/utils";
import { CamSchema, ConfigSchema, WidgetSchema } from "@/lib/types";

const cam = (over: Record<string, unknown> = {}) =>
  CamSchema.parse({
    id: "cam-eingang",
    name: "Eingang",
    model: "RLC-811A",
    ip: "192.168.1.51",
    username: "admin",
    ...over,
  });

const widget = (id: string) =>
  WidgetSchema.parse({ id, type: "clock", title: "Uhr" });

describe("ID-Format", () => {
  it("akzeptiert die IDs, die die Admin-UI erzeugt", () => {
    for (const id of ["cam-eingang", "w-schanze-1", "cam-cam-192-168-1-5", "a", "x_y", "x".repeat(40)]) {
      expect(isConfigId(id)).toBe(true);
    }
  });

  it("lehnt andere Zeichen und Überlängen ab", () => {
    for (const id of ["", "Cam", "a b", "a\nb", "a:b", "a.b", "ä", "x".repeat(41)]) {
      expect(isConfigId(id)).toBe(false);
    }
  });

  it("kürzt automatisch erzeugte IDs auf 40 Zeichen", () => {
    const long = `cam-${"parkplatz-einfahrt-nord-".repeat(3)}`;
    const id = clampConfigId(long);
    expect(id.length).toBeLessThanOrEqual(40);
    expect(id.endsWith("-")).toBe(false);
    expect(isConfigId(id)).toBe(true);
    expect(clampConfigId("cam-eingang")).toBe("cam-eingang");
    expect(clampConfigId("x".repeat(40))).toBe("x".repeat(40));
  });

  it("gekürzte IDs mit gleichem Anfang bleiben verschieden", () => {
    const a = clampConfigId("cam-parkplatz-einfahrt-nord-wasserski-links");
    const b = clampConfigId("cam-parkplatz-einfahrt-nord-wasserski-rechts");
    expect(a).not.toBe(b);
    for (const id of [a, b]) {
      expect(id.length).toBeLessThanOrEqual(40);
      expect(isConfigId(id)).toBe(true);
    }
    // Gleiches Ergebnis wie scripts/import-found-cams.py (clamp_id).
    expect(a).toBe("cam-parkplatz-einfahrt-nord-wasse-xurjff");
    expect(b).toBe("cam-parkplatz-einfahrt-nord-wasse-bf9ssp");
  });
});

describe("Adressen", () => {
  it("IP-Adressen", () => {
    expect(isIpAddress("192.168.1.51")).toBe(true);
    expect(isIpAddress("fe80::1")).toBe(false);
    expect(isIpAddress("fe80::1%en0")).toBe(false);
    expect(isIpAddress("1.2.3.4\n")).toBe(false);
    expect(isIpAddress(" 1.2.3.4")).toBe(false);
    expect(isIpAddress("192.168.1.51:80")).toBe(false);
    expect(isIpAddress("example.com")).toBe(false);
    expect(isIpAddress("")).toBe(false);
  });

  it("http(s)-URLs", () => {
    expect(isHttpUrl("https://emp-access.de")).toBe(true);
    expect(isHttpUrl("http://127.0.0.1:1984")).toBe(true);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("emp-access.de")).toBe(false);
    expect(isHttpUrl("http://127.0.0.1:1984 ")).toBe(false);
    expect(isHttpUrl("http://127.0.0.1:1984\n")).toBe(false);
  });
});

describe("Kamera und Widget beim Speichern", () => {
  it("neue Kamera: ID und IP werden geprüft", () => {
    expect(camWriteErrors(cam(), null)).toEqual([]);
    expect(camWriteErrors(cam({ id: "Cam Eingang" }), null)).toHaveLength(1);
    expect(camWriteErrors(cam({ ip: "kamera.example" }), null)).toHaveLength(1);
  });

  it("bestehende Kamera: alte ID und unveränderte IP bleiben erlaubt", () => {
    const legacy = cam({ id: "Alte Kamera", ip: "kamera.local" });
    expect(camWriteErrors({ ...legacy, name: "Neu" }, legacy)).toEqual([]);
    expect(camWriteErrors({ ...legacy, ip: "kamera2.local" }, legacy)).toHaveLength(1);
    expect(camWriteErrors({ ...legacy, ip: "192.168.1.52" }, legacy)).toEqual([]);
  });

  it("Widget: nur neue IDs werden geprüft", () => {
    expect(widgetWriteErrors(widget("w-uhr"), null)).toEqual([]);
    expect(widgetWriteErrors(widget("W Uhr"), null)).toHaveLength(1);
    expect(widgetWriteErrors(widget("W Uhr"), widget("W Uhr"))).toEqual([]);
  });
});

describe("DoorBird und Einstellungen beim Speichern", () => {
  const current = ConfigSchema.parse({ doorbird: {}, settings: { empAccess: {} } });

  it("alte Config ohne Teilobjekte wirft nicht", () => {
    const bare = ConfigSchema.parse({});
    expect(configWriteErrors(bare, bare)).toEqual([]);
  });

  it("DoorBird-IP: leer und unverändert erlaubt, neue Werte nur als IP", () => {
    expect(doorbirdWriteErrors(current.doorbird, current.doorbird)).toEqual([]);
    expect(doorbirdWriteErrors({ ...current.doorbird, ip: "192.168.1.30" }, current.doorbird)).toEqual([]);
    expect(doorbirdWriteErrors({ ...current.doorbird, ip: "evil.example" }, current.doorbird)).toHaveLength(1);
  });

  it("URLs: unverändert erlaubt, geänderte nur als http(s)", () => {
    const s = current.settings;
    expect(settingsWriteErrors(s, s)).toEqual([]);
    expect(settingsWriteErrors({ ...s, go2rtcUrl: "" }, s)).toEqual([]);
    expect(settingsWriteErrors({ ...s, go2rtcUrl: "file:///etc" }, s)).toHaveLength(1);
    expect(
      settingsWriteErrors({ ...s, empAccess: { ...s.empAccess, baseUrl: "https://test.example" } }, s),
    ).toEqual([]);
    expect(
      settingsWriteErrors({ ...s, empAccess: { ...s.empAccess, baseUrl: "test.example" } }, s),
    ).toHaveLength(1);
  });

  it("Komplette Config: Bestand bleibt speicherbar, neue Kamera wird geprüft", () => {
    const stored = ConfigSchema.parse({ cams: [cam({ id: "Alt" })], widgets: [widget("Alt-W")] });
    expect(configWriteErrors(stored, stored)).toEqual([]);
    const next = { ...stored, cams: [...stored.cams, cam({ id: "neu\nx" })] };
    expect(configWriteErrors(next, stored)).toHaveLength(1);
  });
});
