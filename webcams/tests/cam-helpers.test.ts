import { describe, expect, it } from "vitest";
import { prepareCamForSave } from "@/lib/cam-helpers";
import { CamSchema, type Cam } from "@/lib/types";

function cam(over: Partial<Cam> = {}): Cam {
  return CamSchema.parse({
    id: "cam-drehkreuze",
    name: "Drehkreuze",
    model: "RLC-810A",
    ip: "192.168.1.75",
    username: "admin",
    password: "secret",
    peopleCounter: {
      enabled: true,
      mode: "crossing",
      line: [
        [0.1, 0.7],
        [0.9, 0.3],
      ],
      direction: "ab",
      intervalSec: 60,
    },
    tailgate: {
      enabled: true,
      deviceIds: [49, 51, 53],
      countDirection: "in",
      windowSec: 600,
      tolerance: 3,
      cooldownSec: 900,
      contextCamIds: ["cam-eingang"],
      instantAlert: true,
      notifyShopMonitor: true,
    },
    ...over,
  });
}

describe("prepareCamForSave", () => {
  it("zieht Crossing und Linie nach, wenn nur die Kontrolle an ist", () => {
    const existing = cam();
    const incoming = {
      ...existing,
      password: "***",
      peopleCounter: {
        ...existing.peopleCounter,
        enabled: false,
        mode: "presence",
        line: null,
      },
    };
    const prepared = prepareCamForSave(incoming, existing);
    const parsed = CamSchema.parse(prepared);
    expect(parsed.password).toBe("secret");
    expect(parsed.peopleCounter.enabled).toBe(true);
    expect(parsed.peopleCounter.mode).toBe("crossing");
    expect(parsed.peopleCounter.line).toEqual([
      [0.1, 0.7],
      [0.9, 0.3],
    ]);
  });

  it("behält Geräte-IDs, wenn das Formular sie leer lässt", () => {
    const existing = cam();
    const incoming = {
      ...existing,
      tailgate: { ...existing.tailgate, deviceIds: [] },
    };
    const parsed = CamSchema.parse(prepareCamForSave(incoming, existing));
    expect(parsed.tailgate.deviceIds).toEqual([49, 51, 53]);
  });
});
