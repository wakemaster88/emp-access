"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobRow, ZoneStatus } from "./types";

/** Zonen ändern ihren Zustand im Sekundenbereich – häufiger als andere Module. */
const POLL_MS = 8_000;

interface AudioStatus {
  zones: Map<number, ZoneStatus>;
  jobs: JobRow[] | null;
  refresh: () => void;
}

/**
 * Hält den Ist-Zustand der Zonen aktuell.
 *
 * Läuft nur, solange der Tab sichtbar ist – ein im Hintergrund vergessenes
 * Dashboard soll nicht dauerhaft Abfragen erzeugen.
 */
export function useAudioStatus(enabled: boolean): AudioStatus {
  const [zones, setZones] = useState<Map<number, ZoneStatus>>(new Map());
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const inFlight = useRef(false);
  const queued = useRef(false);

  const load = useCallback(async () => {
    // Eine Anfrage während einer laufenden darf nicht verfallen: sie kommt
    // typischerweise direkt nach einem Steuerbefehl, dessen Wirkung die gerade
    // unterwegs befindliche Antwort noch gar nicht enthalten kann.
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        const res = await fetch("/api/audio/status");
        if (!res.ok) return;
        const data = (await res.json()) as { zones: ZoneStatus[]; jobs: JobRow[] };
        setZones(new Map(data.zones.map((zone) => [zone.id, zone])));
        setJobs(data.jobs);
      } while (queued.current);
    } catch {
      // Netzwerkaussetzer sind hier unkritisch: die zuletzt bekannten Werte
      // bleiben stehen, der nächste Durchlauf holt sie wieder ein.
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

  return { zones, jobs, refresh: load };
}
