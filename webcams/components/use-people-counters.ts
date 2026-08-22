"use client";

import { useEffect, useState } from "react";

export interface PresenceCounter {
  mode: "presence";
  count: number | null;
  lastUpdate: number;
  lastError?: string;
  history: { ts: number; count: number }[];
}

export interface CrossingCounter {
  mode: "crossing";
  in: number;
  out: number;
  delta: number;
  lastUpdate: number;
  lastError: string | null;
  fps: number;
}

export interface ZoneCounter {
  mode: "zone";
  count: number;
  lastUpdate: number;
  lastError: string | null;
  fps: number;
}

export interface VehicleZoneCounter {
  mode: "vehicle-zone";
  count: number;
  lastUpdate: number;
  lastError: string | null;
  fps: number;
}

export type CounterValue =
  | PresenceCounter
  | CrossingCounter
  | ZoneCounter
  | VehicleZoneCounter;

type Counters = Record<string, CounterValue>;

let cache: Counters = {};
const listeners = new Set<(c: Counters) => void>();
let polling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const POLL_MS = 5000;

async function fetchCounters() {
  try {
    const r = await fetch("/api/counters", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { counters: Counters };
    cache = data.counters ?? {};
    for (const fn of listeners) fn(cache);
  } catch {
    // ignore — temporäre Fetch-Fehler nicht eskalieren
  }
}

function ensurePolling() {
  if (polling) return;
  polling = true;
  void fetchCounters();
  pollTimer = setInterval(fetchCounters, POLL_MS);
}

function maybeStopPolling() {
  if (listeners.size > 0) return;
  polling = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function usePeopleCounters(): Counters {
  const [c, setC] = useState<Counters>(cache);
  useEffect(() => {
    listeners.add(setC);
    ensurePolling();
    return () => {
      listeners.delete(setC);
      maybeStopPolling();
    };
  }, []);
  return c;
}

export function usePeopleCount(camId: string | undefined): CounterValue | null {
  const counters = usePeopleCounters();
  if (!camId) return null;
  return counters[camId] ?? null;
}
