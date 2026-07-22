import { EventEmitter } from "node:events";

/**
 * Globaler PubSub-Bus für Server-Side-Events (Doorbird Klingel etc.).
 * In-Memory, single-process. Bei Mehrfach-Instanz würde Redis/Upstash
 * nötig – für lokales Setup auf dem Mac reicht das.
 */

export interface RingEvent {
  type: "ring";
  source: "doorbird";
  ts: string;
  meta?: Record<string, unknown>;
}

export interface MotionEvent {
  type: "motion";
  source: string;
  ts: string;
  meta?: Record<string, unknown>;
}

export type BusEvent = RingEvent | MotionEvent;

declare global {
  // eslint-disable-next-line no-var
  var __webcams_event_bus: EventEmitter | undefined;
  // eslint-disable-next-line no-var
  var __webcams_last_ring_at: number | undefined;
}

const bus = (globalThis.__webcams_event_bus ??= new EventEmitter());
bus.setMaxListeners(50);

const RING_DEDUPE_MS = 5000;

export function publishRing(meta?: Record<string, unknown>) {
  const now = Date.now();
  const last = globalThis.__webcams_last_ring_at ?? 0;
  if (now - last < RING_DEDUPE_MS) {
    return false;
  }
  globalThis.__webcams_last_ring_at = now;
  const event: RingEvent = {
    type: "ring",
    source: "doorbird",
    ts: new Date(now).toISOString(),
    meta,
  };
  bus.emit("event", event);
  return true;
}

export function getLastRingAt(): number {
  return globalThis.__webcams_last_ring_at ?? 0;
}

export function subscribe(handler: (ev: BusEvent) => void): () => void {
  bus.on("event", handler);
  return () => bus.off("event", handler);
}
