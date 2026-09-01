import { describe, expect, it } from "vitest";
import { CamSchema, ParkingLotSchema } from "@/lib/types";

const baseCam = {
  id: "cam-halle-2",
  name: "Halle",
  model: "RLC-811A" as const,
  ip: "192.168.1.119",
  username: "admin",
  password: "secret",
};

const box: [number, number][] = [
  [0.1, 0.4],
  [0.25, 0.4],
  [0.25, 0.7],
  [0.1, 0.7],
];

describe("ParkingLotSchema", () => {
  it("parst Defaults für bestehende Cams ohne Feld", () => {
    const cam = CamSchema.parse(baseCam);
    expect(cam.parkingLot.enabled).toBe(false);
    expect(cam.parkingLot.spots).toEqual([]);
  });

  it("erlaubt mehrere benannte Boxen", () => {
    const lot = ParkingLotSchema.parse({
      enabled: true,
      spots: [
        { id: "p1", name: "1", zone: box },
        { id: "p2", name: "2", zone: box.map(([x, y]) => [x + 0.2, y]) },
      ],
    });
    const cam = CamSchema.parse({ ...baseCam, parkingLot: lot });
    expect(cam.parkingLot.spots).toHaveLength(2);
    expect(cam.parkingLot.spots[0].name).toBe("1");
  });

  it("lehnt Parkplatz zusammen mit Personen-Zone ab", () => {
    const parsed = CamSchema.safeParse({
      ...baseCam,
      peopleCounter: {
        enabled: true,
        mode: "zone",
        zone: box,
      },
      parkingLot: {
        enabled: true,
        spots: [{ id: "p1", name: "1", zone: box }],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("lehnt aktive Belegung ohne Boxen ab", () => {
    const parsed = CamSchema.safeParse({
      ...baseCam,
      parkingLot: { enabled: true, spots: [] },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.path.join(".").includes("spots")),
      ).toBe(true);
    }
  });
});
