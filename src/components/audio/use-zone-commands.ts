"use client";

import { useCallback, useEffect, useState } from "react";
import {
  resolveCommands,
  type ZoneCommandAction,
  type ZoneCommandState,
} from "@/lib/audio-zone-commands";
import type { JobRow, ZoneStatus } from "./types";

export type { ZoneCommandAction, ZoneCommandState };

/**
 * Hält fest, welche Zone gerade auf Start oder Stopp wartet, und löst den
 * Zustand auf, sobald die Zone ihn meldet oder der Befehl im Verlauf scheitert.
 *
 * Vorher sprang die Taste nach dem Absenden sofort zurück auf „Start“, und bis
 * der Abspieler sich meldete, sah es aus, als wäre nichts passiert – oder der
 * Befehl verfiel still, ohne dass es jemand merkte.
 */
export function useZoneCommands({
  liveZones,
  liveJobs,
  refreshStatus,
}: {
  liveZones: Map<number, ZoneStatus>;
  liveJobs: JobRow[] | null;
  refreshStatus: () => void;
}) {
  const [commands, setCommands] = useState<Map<number, ZoneCommandState>>(new Map());
  const [now, setNow] = useState(() => Date.now());

  const waiting = [...commands.values()].some((c) => c.phase !== "failed");
  const anyCommand = commands.size > 0;

  // Sekundentakt nur, solange etwas offen ist: für die Wartezeit in der Taste
  // und für das Auflösen nach Ablauf.
  useEffect(() => {
    if (!anyCommand) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyCommand]);

  // Während ein Befehl offen ist, öfter nachfragen als die üblichen 15 s.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(refreshStatus, 2500);
    return () => clearInterval(timer);
  }, [waiting, refreshStatus]);

  // Offene Befehle mit dem Ist-Zustand abgleichen. Abgeleiteter Zustand: nur
  // setzen, wenn sich wirklich etwas ändert, sonst entstünde eine Schleife.
  const resolved = resolveCommands(commands, liveZones, liveJobs, now);
  if (resolved !== commands) setCommands(resolved);

  const send = useCallback(
    async (zoneId: number, action: ZoneCommandAction) => {
      const since = Date.now();
      setCommands((prev) => new Map(prev).set(zoneId, { action, phase: "sending", since }));
      let message: string | null = null;
      try {
        const res = await fetch(`/api/audio/zones/${zoneId}/control`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          message = typeof data.error === "string" ? data.error : "Befehl fehlgeschlagen";
        }
      } catch {
        message = "Keine Verbindung zum Server · Netz prüfen und erneut versuchen";
      }
      setCommands((prev) =>
        new Map(prev).set(
          zoneId,
          message
            ? { action, phase: "failed", since, message }
            : { action, phase: "waiting", since }
        )
      );
      if (!message) refreshStatus();
    },
    [refreshStatus]
  );

  const dismiss = useCallback((zoneId: number) => {
    setCommands((prev) => {
      if (!prev.has(zoneId)) return prev;
      const next = new Map(prev);
      next.delete(zoneId);
      return next;
    });
  }, []);

  return { commands, now, send, dismiss };
}

