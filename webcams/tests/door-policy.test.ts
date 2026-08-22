import { describe, expect, it } from "vitest";
import { evaluateDoorOpen } from "@/lib/door-policy";

const NOW = 1_750_000_000_000;

describe("evaluateDoorOpen", () => {
  it("erlaubt UI-Öffnen innerhalb des Ring-Fensters", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "ui",
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
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(false);
    expect(d.elapsedMs).toBe(-1);
  });

  it("erlaubt ALPR-Auto-Open auch außerhalb des Fensters", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "alpr",
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(true);
  });

  it("erlaubt Ausfahrt-Zone auch außerhalb des Fensters", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: true,
      source: "vehicle-gate",
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(true);
  });

  it("erlaubt alles, wenn Enforcement deaktiviert ist", () => {
    const d = evaluateDoorOpen({
      enforceRingWindow: false,
      source: "ui",
      lastRingAt: 0,
      now: NOW,
      ringWindowSec: 90,
    });
    expect(d.allowed).toBe(true);
  });
});
