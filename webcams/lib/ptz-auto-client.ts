import { loadConfig } from "./config";
import { sidecarAuthHeaders } from "./auth";

/**
 * Dünner Client für die PTZ-Auto-Endpoints im Python-Sidecar.
 *
 * Wir benachrichtigen den Sidecar bei manuellen PTZ-Eingriffen, damit er
 * den Auto-Pilot kurz pausiert (sonst kämpfen User und Sidecar gegeneinander).
 *
 * Außerdem proxen wir den Status für die Admin-UI.
 */

async function trackerBase(): Promise<string> {
  const config = await loadConfig();
  return config.settings.tracker.url.replace(/\/$/, "");
}

/** Sagt dem Sidecar: "User hat manuell PTZ gemacht, bitte pausieren". */
export async function notifyManualPtz(camId: string, holdSec = 90): Promise<void> {
  try {
    const base = await trackerBase();
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 1200);
    try {
      await fetch(`${base}/ptz-auto/manual-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await sidecarAuthHeaders()) },
        body: JSON.stringify({ camId, holdSec }),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Sidecar offline → ignorieren, manueller PTZ funktioniert ja unabhängig
  }
}

export interface PtzAutoStatusEntry {
  mode: string;
  subState: string;
  lastAction: string;
  lastError: string | null;
  lastUpdate: number;
  lastTargetAt: number;
  lastTargetId: number | null;
  patrolIdx: number;
  fps: number;
  manualOverrideRemaining: number;
}

export async function fetchPtzAutoStatus(): Promise<Record<string, PtzAutoStatusEntry>> {
  try {
    const base = await trackerBase();
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 2000);
    try {
      const r = await fetch(`${base}/ptz-auto/status`, {
        signal: ctl.signal,
        cache: "no-store",
        headers: await sidecarAuthHeaders(),
      });
      if (!r.ok) return {};
      const j = (await r.json()) as { ptz?: Record<string, PtzAutoStatusEntry> };
      return j.ptz ?? {};
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return {};
  }
}
