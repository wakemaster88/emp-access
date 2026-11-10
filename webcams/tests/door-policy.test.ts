import { describe, expect, it } from "vitest";
import { evaluateDoorOpen, resolveDoorSource } from "@/lib/door-policy";

const NOW = 1_750_000_000_000;

describe("evaluateDoorOpen", () => {
  it("erlaubt UI-Öffnen innerhalb des Ring-Fensters", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "ui",
      internal: false,
      lastRingAt: NOW - 30_000,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(true);
    expect(d.inWindow).toBe(true);
  });

  it("blockiert UI-Öffnen nach Ablauf des Ring-Fensters", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "ui",
      internal: false,
      lastRingAt: NOW - 120_000,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/abgelaufen/);
  });

  it("blockiert UI-Öffnen, wenn nie geklingelt wurde", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "ui",
      internal: false,
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(false);
    expect(d.elapsedMs).toBe(-1);
  });

  it("erlaubt ALPR-Auto-Open mit internem Token auch außerhalb des Fensters", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "alpr",
      internal: true,
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(true);
  });

  it("erlaubt Ausfahrt-Zone mit internem Token auch außerhalb des Fensters", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "vehicle-gate",
      internal: true,
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(true);
  });

  it("blockiert alpr/vehicle-gate ohne internes Token außerhalb des Fensters", () => {
    for (const source of ["alpr", "vehicle-gate"]) {
      const d = evaluateDoorOpen({
        enforceRingWindow: true,
        source,
        internal: false,
        lastRingAt: 0,
        now: NOW,
        ringWindowSec: 90,
      });
      expect(d.allowed).toBe(false);
    }
  });

  it("gibt internen Aufrufen mit anderer Quelle keine Ausnahme", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "ui",
      internal: true,
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(false);
  });

  it("erlaubt alles, wenn Enforcement deaktiviert ist", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: false,
      source: "ui",
      internal: false,
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(true);
  });
});

describe("resolveDoorSource", () => {
  it("ignoriert die behauptete Quelle ohne internes Token", () => {
    expect(resolveDoorSource("alpr", false)).toBe("ui");
    expect(resolveDoorSource("vehicle-gate", false)).toBe("ui");
    expect(resolveDoorSource("irgendwas", false)).toBe("ui");
    expect(resolveDoorSource(undefined, false)).toBe("ui");
  });

  it("übernimmt die Quelle bei internem Aufruf", () => {
    expect(resolveDoorSource("alpr", true)).toBe("alpr");
    expect(resolveDoorSource(undefined, true)).toBe("ui");
    expect(resolveDoorSource("", true)).toBe("ui");
  });

  it("ein Browser mit source=alpr kommt nicht am Ring-Fenster vorbei", () => {
    const internal = false;
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: resolveDoorSource("alpr", internal),
      internal,
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(false);
  });
});
