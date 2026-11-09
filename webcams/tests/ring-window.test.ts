import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLastRingAt, publishRing, subscribe, type BusEvent } from "@/lib/event-bus";

const T0 = 1_750_000_000_000;

describe("publishRing / Ring-Fenster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    globalThis.__webcams_last_ring_at = undefined;
    globalThis.__webcams_last_test_ring_at = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Test-Klingel zeigt das Overlay, öffnet aber kein Ring-Fenster", () => {
    const seen: BusEvent[] = [];
    const off = subscribe((ev) => seen.push(ev));
    expect(publishRing({ test: true }, { test: true })).toBe(true);
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("ring");
    expect(getLastRingAt()).toBe(0);
  });

  it("echtes Klingeln öffnet das Ring-Fenster", () => {
    expect(publishRing()).toBe(true);
    expect(getLastRingAt()).toBe(T0);
  });

  it("Test-Klingel verlängert ein laufendes Fenster nicht", () => {
    publishRing();
    vi.setSystemTime(T0 + 60_000);
    expect(publishRing({ test: true }, { test: true })).toBe(true);
    expect(getLastRingAt()).toBe(T0);
  });

  it("echtes Klingeln wird von einer Test-Klingel davor nicht verschluckt", () => {
    publishRing({ test: true }, { test: true });
    vi.setSystemTime(T0 + 1_000);
    expect(publishRing()).toBe(true);
    expect(getLastRingAt()).toBe(T0 + 1_000);
  });

  it("dedupliziert Klingeln innerhalb von 5 s", () => {
    expect(publishRing()).toBe(true);
    vi.setSystemTime(T0 + 2_000);
    expect(publishRing()).toBe(false);
    expect(publishRing({ test: true }, { test: true })).toBe(false);
    expect(getLastRingAt()).toBe(T0);
    vi.setSystemTime(T0 + 6_000);
    expect(publishRing()).toBe(true);
    expect(getLastRingAt()).toBe(T0 + 6_000);
  });
});
