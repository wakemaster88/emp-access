import { describe, expect, it } from "vitest";
import { CamSchema, VehicleGateSchema } from "@/lib/types";

const baseCam = {
  id: "cam-halle-2",
  name: "Halle",
  model: "RLC-811A",
  ip: "192.168.1.119",
  username: "admin",
  password: "secret",
};

const gateZone: [number, number][] = [
  [0.55, 0.5],
  [0.82, 0.44],
  [0.94, 0.52],
  [0.9, 0.74],
  [0.56, 0.76],
];

describe("VehicleGateSchema", () => {
  it("parst Defaults für bestehende Cams ohne Feld", () => {
    const cam = CamSchema.parse(baseCam);
    expect(cam.vehicleGate.enabled).toBe(false);
    expect(cam.vehicleGate.zone).toBeNull();
    // Voreinstellung: nicht öffnen, nur bei ausdrücklicher Angabe.
    expect(cam.vehicleGate.openDoorbird).toBe(false);
    expect(cam.vehicleGate.deviceIds).toEqual([]);
    expect(cam.vehicleGate.cooldownSec).toBe(45);
  });

  it("aktive Fläche ohne openDoorbird öffnet nicht (Feld fehlt in der Datei)", () => {
    const cam = CamSchema.parse({ ...baseCam, vehicleGate: { enabled: true, zone: gateZone } });
    expect(cam.vehicleGate.openDoorbird).toBe(false);
  });

  it("ausdrücklich gesetztes openDoorbird bleibt", () => {
    const cam = CamSchema.parse({ ...baseCam, vehicleGate: { enabled: true, zone: gateZone, openDoorbird: true } });
    expect(cam.vehicleGate.openDoorbird).toBe(true);
  });

  it("DoorBird öffnen nur mit openDoorbirdConfirmed: ab Werk false", () => {
    expect(VehicleGateSchema.parse({}).openDoorbirdConfirmed).toBe(false);
    expect(CamSchema.parse(baseCam).vehicleGate.openDoorbirdConfirmed).toBe(false);
  });

  it("alte Datei mit openDoorbird: true (frühere Voreinstellung): openDoorbirdConfirmed bleibt false", () => {
    const cam = CamSchema.parse({ ...baseCam, vehicleGate: { enabled: true, zone: gateZone, openDoorbird: true } });
    expect(cam.vehicleGate.openDoorbirdConfirmed).toBe(false);
  });

  it("keine Voreinstellung schreibt openDoorbirdConfirmed als true in die Datei", () => {
    // Wie saveConfig: geparst und so geschrieben.
    const written = JSON.parse(JSON.stringify(CamSchema.parse({ ...baseCam, vehicleGate: { enabled: true, zone: gateZone } })));
    expect(written.vehicleGate.openDoorbirdConfirmed).toBe(false);
    expect(written.vehicleGate.openDoorbird).toBe(false);
    const defaults = JSON.parse(JSON.stringify(CamSchema.parse(baseCam)));
    expect(defaults.vehicleGate.openDoorbirdConfirmed).toBe(false);
  });

  it("vom Schalter gesetztes openDoorbirdConfirmed bleibt", () => {
    const cam = CamSchema.parse({
      ...baseCam,
      vehicleGate: { enabled: true, zone: gateZone, openDoorbird: true, openDoorbirdConfirmed: true },
    });
    expect(cam.vehicleGate.openDoorbirdConfirmed).toBe(true);
  });

  it("erlaubt aktive Ausfahrt-Zone mit Fläche und DoorBird", () => {
    const vg = VehicleGateSchema.parse({
      enabled: true,
      zone: gateZone,
      openDoorbird: true,
    });
    const cam = CamSchema.parse({ ...baseCam, vehicleGate: vg });
    expect(cam.vehicleGate.enabled).toBe(true);
    expect(cam.vehicleGate.zone).toHaveLength(5);
  });

  it("lehnt aktive Zone ohne Fläche ab", () => {
    const parsed = CamSchema.safeParse({
      ...baseCam,
      vehicleGate: { enabled: true, zone: null, openDoorbird: true },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.path.join(".").includes("zone")),
      ).toBe(true);
    }
  });

  it("erlaubt eine reine Zählfläche ohne DoorBird und ohne Gerät", () => {
    const parsed = CamSchema.safeParse({
      ...baseCam,
      vehicleGate: {
        enabled: true,
        zone: gateZone,
        openDoorbird: false,
        deviceIds: [],
      },
    });
    expect(parsed.success).toBe(true);
  });
});
