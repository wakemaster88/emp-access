"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Meldet neue Zutritts-Scans der Geräte, die eine Kamera im Bild hat —
 * damit die Kachel im Moment des Scans aufleuchten kann.
 *
 * Zwischen Scan und Durchgang liegen an den Drehkreuzen zwei bis vier
 * Sekunden. Das Aufleuchten fällt also mit der Person zusammen, die man
 * gerade durchgehen sieht.
 *
 * Grün bleibt bewusst kurz: In Stoßzeiten kommt alle paar Sekunden ein
 * gültiger Scan, und ein Dauerflackern auf einem Bildschirm, der rund um die
 * Uhr läuft, sieht man nach einer Weile nicht mehr. Abgelehnte Scans sind
 * selten und bleiben deshalb deutlich länger stehen.
 */

export type ScanResult = "GRANTED" | "DENIED" | "PROTECTED";

export interface ScanFlash {
  id: number;
  result: ScanResult;
  /** Kurzname des Drehkreuzes, z. B. „Eingang B". */
  device: string;
  ticket: string | null;
}

interface ScanRow {
  id: number;
  ts: number;
  result: ScanResult;
  device: string;
  deviceId: number | null;
  ticket: string | null;
}

const POLL_MS = 2000;
const HOLD_GRANTED_MS = 1400;
const HOLD_DENIED_MS = 6000;

/** „Strandbad - Eingang B" → „Eingang B". Der Standort steht ohnehin dran. */
function shortDevice(name: string): string {
  const cut = name.split(" - ");
  return (cut.length > 1 ? cut.slice(1).join(" - ") : name).trim() || name;
}

export interface ScanFlashState {
  /** Der zuletzt gemeldete Scan — bleibt für das weiche Ausblenden stehen. */
  flash: ScanFlash | null;
  /** Ob gerade aufgeleuchtet werden soll. */
  visible: boolean;
}

export function useScanFlash(
  deviceIds: number[],
  enabled: boolean,
): ScanFlashState {
  const [state, setState] = useState<ScanFlashState>({
    flash: null,
    visible: false,
  });
  // Als String, damit der Effekt nicht bei jedem Render neu startet.
  const key = deviceIds.join(",");
  const active = enabled && key.length > 0;

  const seen = useRef<Set<number> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    // Anderer Gerätesatz: Zählung neu beginnen, nicht rückwirkend aufleuchten.
    seen.current = null;
    const wanted = new Set(key.split(",").map(Number));
    let alive = true;

    async function poll() {
      try {
        const r = await fetch("/api/emp-access/scans?limit=25", {
          cache: "no-store",
        });
        if (!r.ok || !alive) return;
        const body = (await r.json()) as { scans?: ScanRow[] };
        const rows = (body.scans ?? []).filter(
          (s) => s.deviceId !== null && wanted.has(s.deviceId),
        );
        if (!alive) return;

        // Beim ersten Durchlauf nur merken — sonst leuchtet die Kachel auf,
        // sobald jemand das Dashboard öffnet.
        if (seen.current === null) {
          seen.current = new Set(rows.map((s) => s.id));
          return;
        }
        const fresh = rows.filter((s) => !seen.current!.has(s.id));
        for (const s of rows) seen.current.add(s.id);
        if (fresh.length === 0) return;

        // Kamen mehrere auf einmal, gewinnt der abgelehnte — der ist die
        // Information, wegen der man überhaupt hinschaut.
        const pick =
          fresh.find((s) => s.result !== "GRANTED") ??
          fresh.reduce((a, b) => (b.ts > a.ts ? b : a));

        if (hideTimer.current) clearTimeout(hideTimer.current);
        setState({
          flash: {
            id: pick.id,
            result: pick.result,
            device: shortDevice(pick.device),
            ticket: pick.ticket,
          },
          visible: true,
        });
        hideTimer.current = setTimeout(
          () => {
            // Nur ausblenden, nicht leeren — sonst springt der Text weg,
            // bevor die Überblendung durch ist.
            if (alive) setState((s) => ({ ...s, visible: false }));
          },
          pick.result === "GRANTED" ? HOLD_GRANTED_MS : HOLD_DENIED_MS,
        );
      } catch {
        // Nächster Tick versucht es erneut.
      }
    }

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [key, active]);

  return active ? state : { flash: null, visible: false };
}
