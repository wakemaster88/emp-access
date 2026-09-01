"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SensorReading } from "@/lib/shelly-sensor";

/** Antwortform von `GET /api/devices/shelly-statuses`. */
export interface DeviceStatus {
  id: number;
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
  motion?: string;
  position?: number | null;
  readings?: SensorReading[];
}

/** Abstand zwischen zwei Statusabfragen. */
const POLL_INTERVAL_MS = 20_000;

/** Takt, in dem die "vor 3 Min"-Angaben nachziehen. */
const CLOCK_INTERVAL_MS = 30_000;

/**
 * Laufende Uhr fuer relative Zeitangaben.
 *
 * Startet mit dem Zeitstempel, den der Server mitgeliefert hat, damit das
 * erste Rendern im Browser dasselbe Markup erzeugt wie auf dem Server. Erst
 * nach dem Mounten wird auf die echte Browserzeit umgeschaltet.
 */
export function useNow(initialMs: number): number {
  const [now, setNow] = useState(initialMs);

  useEffect(() => {
    const sync = () => setNow(Date.now());
    // Nicht synchron im Effekt setzen: der erste Abgleich laeuft kurz nach dem
    // Mounten, danach im festen Takt.
    const first = setTimeout(sync, 1_000);
    const timer = setInterval(sync, CLOCK_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  return now;
}

/**
 * Live-Zustand der Shelly-Geraete im Blick behalten.
 *
 * Nur Shelly-Geraete haben eine Statusabfrage; Smart Locks, GARDENA und Audio
 * melden ihren Zustand ueber eigene Wege und bleiben hier aussen vor. Die
 * Abfrage laeuft ueber einen einzigen Endpunkt fuer alle IDs, weil die Shelly
 * Cloud nur etwa eine Anfrage pro Sekunde zulaesst.
 */
export function useDeviceStatuses(deviceIds: number[]): {
  statuses: Map<number, DeviceStatus>;
  loading: boolean;
  refresh: () => void;
} {
  const [statuses, setStatuses] = useState<Map<number, DeviceStatus>>(new Map());
  const [loading, setLoading] = useState(deviceIds.length > 0);
  // Als String vergleichbar: verhindert, dass ein neues Array bei jedem Render
  // den Effekt erneut startet.
  const key = deviceIds.join(",");
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(async (ids: string) => {
    if (!ids) {
      setStatuses(new Map());
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/devices/shelly-statuses?ids=${ids}`);
      if (!res.ok) return;
      const list = (await res.json()) as DeviceStatus[];
      setStatuses(new Map(list.map((s) => [s.id, s])));
    } catch {
      // Netzwerkfehler: alten Stand stehen lassen, der naechste Takt versucht es erneut.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void load(keyRef.current);
    };
    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, load]);

  const refresh = useCallback(() => void load(keyRef.current), [load]);

  return { statuses, loading, refresh };
}
