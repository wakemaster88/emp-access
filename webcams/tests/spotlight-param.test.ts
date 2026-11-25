import { describe, expect, it } from "vitest";
import { legacyWhiteLedParam, spotlightLegacy, spotlightParam, whiteLedParam } from "@/lib/spotlight-param";

const cur = (o: Record<string, unknown> = {}) => ({
  channel: 0,
  state: 0,
  mode: 0,
  bright: 60,
  LightingSchedule: { StartHour: 18, StartMin: 0, EndHour: 6, EndMin: 0 },
  ...o,
});

describe("Weißlicht: nur an und aus", () => {
  it("Lichtmodus und Helligkeit bleiben, wie die Kamera sie meldet", () => {
    expect(whiteLedParam(cur(), true)).toEqual({ state: 1, mode: 0, bright: 60 });
    expect(whiteLedParam(cur({ state: 1, mode: 3 }), false, 100)).toEqual({ state: 0, mode: 3, bright: 60 });
  });

  it("Helligkeit nur beim Einschalten mit ausdrücklicher Angabe", () => {
    expect(whiteLedParam(cur(), true, 100)).toEqual({ state: 1, mode: 0, bright: 100 });
  });

  it("ohne brauchbaren Stand oder mit Rückschalter der frühere Befehl", () => {
    expect(whiteLedParam(null, true)).toBeNull();
    expect(whiteLedParam(cur({ mode: "1" }), true)).toBeNull();
    expect(spotlightParam({ legacy: false, current: null, on: true })).toEqual({ state: 1, mode: 1, bright: 100 });
    expect(spotlightParam({ legacy: true, current: cur(), on: false })).toEqual(legacyWhiteLedParam(false));
    expect(legacyWhiteLedParam(true, 40)).toEqual({ state: 1, mode: 1, bright: 40 });
  });

  it("WEBCAMS_SPOTLIGHT_LEGACY: 1, true, ja, on", () => {
    for (const on of ["1", "true", "ja", "on"]) expect(spotlightLegacy(on)).toBe(true);
    for (const off of [undefined, "", "0", "nein"]) expect(spotlightLegacy(off)).toBe(false);
  });
});
