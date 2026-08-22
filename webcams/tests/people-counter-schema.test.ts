import { describe, expect, it } from "vitest";
import { CamSchema, PeopleCounterSchema } from "@/lib/types";

const baseCam = {
  id: "cam-aquapark",
  name: "Aquapark",
  model: "Duo 3",
  ip: "192.168.1.80",
  username: "admin",
  password: "secret",
};

describe("PeopleCounterSchema zone", () => {
  it("erlaubt mode=zone mit Polygon", () => {
    const pc = PeopleCounterSchema.parse({
      enabled: true,
      mode: "zone",
      zone: [
        [0.1, 0.2],
        [0.9, 0.2],
        [0.8, 0.8],
        [0.15, 0.75],
      ],
    });
    expect(pc.mode).toBe("zone");
    expect(pc.zone).toHaveLength(4);
  });

  it("lehnt Zone ohne Fläche ab, sobald die Cam aktiv zählt", () => {
    const parsed = CamSchema.safeParse({
      ...baseCam,
      peopleCounter: { enabled: true, mode: "zone", zone: null },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.path.join(".").includes("zone")),
      ).toBe(true);
    }
  });

  it("parst bestehende Cams ohne zone-Feld", () => {
    const cam = CamSchema.parse({
      ...baseCam,
      peopleCounter: {
        enabled: false,
        intervalSec: 30,
        mode: "presence",
        line: null,
        direction: "ab",
      },
    });
    expect(cam.peopleCounter.zone).toBeNull();
    expect(cam.peopleCounter.mode).toBe("presence");
  });
});
