"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SoundwebControlStatus, SoundwebDeviceStatus } from "./types";

/**
 * Soundweb-Werte ändern sich auch von außen (Wandpanel, Audio Architect);
 * fünf Sekunden sind ein guter Kompromiss zwischen „sieht man sofort“ und
 * Abfragelast – der Hub meldet Änderungen ohnehin gebündelt.
 */
const POLL_MS = 5_000;

export interface SoundwebStatus {
  loaded: boolean;
  hubOnline: boolean | null;
  devices: Map<number, SoundwebDeviceStatus>;
  controls: Map<number, SoundwebControlStatus>;
  refresh: () => Promise<void>;
}

/** Hält Verbindung und Werte der Soundweb-Karte aktuell, solange der Tab offen ist. */
export function useSoundwebStatus(enabled: boolean): SoundwebStatus {
  const [loaded, setLoaded] = useState(false);
  const [hubOnline, setHubOnline] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Map<number, SoundwebDeviceStatus>>(new Map());
  const [controls, setControls] = useState<Map<number, SoundwebControlStatus>>(new Map());
  const inFlight = useRef(false);
  const queued = useRef(false);

  const load = useCallback(async () => {
    // Eine Abfrage direkt nach einem Befehl darf nicht verfallen – die gerade
    // laufende Antwort kennt den neuen Wert noch nicht.
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        const res = await fetch("/api/audio/soundweb/status");
        if (!res.ok) return;
        const data = (await res.json()) as {
          hubOnline: boolean;
          devices: SoundwebDeviceStatus[];
          controls: SoundwebControlStatus[];
        };
        setHubOnline(data.hubOnline);
        setDevices(new Map(data.devices.map((d) => [d.id, d])));
        setControls(new Map(data.controls.map((c) => [c.id, c])));
        setLoaded(true);
      } while (queued.current);
    } catch {
      // Netzaussetzer: alte Werte bleiben stehen, der nächste Takt holt nach.
    } finally {
      queued.current = false;
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void load();
      timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, load]);

  return { loaded, hubOnline, devices, controls, refresh: load };
}
