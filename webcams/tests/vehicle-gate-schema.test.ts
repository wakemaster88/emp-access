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
    expect(cam.vehicleGate.openDoorbird).toBe(true);
    expect(cam.vehicleGate.cooldownSec).toBe(45);
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

  it("lehnt aktive Zone ohne Aktor ab", () => {
    const parsed = CamSchema.safeParse({
      ...baseCam,
      vehicleGate: {
        enabled: true,
        zone: gateZone,
        openDoorbird: false,
        deviceIds: [],
      },
    });
    expect(parsed.success).toBe(false);
  });
});
