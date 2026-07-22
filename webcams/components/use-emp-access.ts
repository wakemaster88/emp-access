"use client";

import { useEffect, useState } from "react";

/** Spiegelt `lib/emp-access-runtime` (nur Typ, kein Runtime-Import im Client-Bundle). */
export type EmpAccessEvent = {
  id: string;
  ts: number;
  camId: string;
  deviceId: number;
  kind: "valid" | "invalid" | "info";
  summary: string;
  detail?: string;
};

export type EmpAccessClientSnap = {
  configured: boolean;
  polledAt: number;
  lastError: string | null;
  loading: boolean;
  byCam: Record<string, EmpAccessEvent[]>;
  pollIntervalSec: number;
};

const initial: EmpAccessClientSnap = {
  configured: false,
  polledAt: 0,
  lastError: null,
  loading: false,
  byCam: {},
  pollIntervalSec: 60,
};

let cache: EmpAccessClientSnap = initial;
const listeners = new Set<(s: EmpAccessClientSnap) => void>();
let polling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function clientPollMs(sec: number): number {
  // Wir wollen am Drehkreuz „relativ live" reagieren. Der Client zieht
  // schneller als das Server-Polling-Intervall: Hälfte davon, aber nie unter
  // 1,5 s und nie über 10 s — der Server selber drosselt korrekt.
  const half = Math.floor(sec * 500);
  return Math.min(Math.max(half, 1500), 10_000);
}

async function fetchSnap() {
  try {
    const r = await fetch("/api/emp-access/events", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as Partial<EmpAccessClientSnap> & {
      pollIntervalSec?: number;
    };
    cache = {
      configured: data.configured ?? false,
      polledAt: data.polledAt ?? 0,
      lastError: data.lastError ?? null,
      loading: data.loading ?? false,
      byCam: data.byCam ?? {},
      pollIntervalSec:
        typeof data.pollIntervalSec === "number" ? data.pollIntervalSec : 60,
    };
    for (const fn of listeners) fn(cache);
    resetInterval();
  } catch {
    // ignorieren
  }
}

function resetInterval() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = setInterval(fetchSnap, clientPollMs(cache.pollIntervalSec));
}

function ensurePolling() {
  if (polling) return;
  polling = true;
  void fetchSnap();
  pollTimer = setInterval(fetchSnap, clientPollMs(cache.pollIntervalSec));
}

function maybeStopPolling() {
  if (listeners.size > 0) return;
  polling = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Globale emp-access-Snapshot-Daten (triggert Server-Poll bei GET). */
export function useEmpAccessSnapshot(): EmpAccessClientSnap {
  const [s, setS] = useState<EmpAccessClientSnap>(cache);
  useEffect(() => {
    listeners.add(setS);
    ensurePolling();
    return () => {
      listeners.delete(setS);
      maybeStopPolling();
    };
  }, []);
  return s;
}

/** Letzte Events nur für eine Kamera (max. wie Server `byCam` liefert). */
export function useEmpAccessForCam(camId: string | undefined): EmpAccessEvent[] {
  const snap = useEmpAccessSnapshot();
  if (!camId) return [];
  return snap.byCam[camId] ?? [];
}
