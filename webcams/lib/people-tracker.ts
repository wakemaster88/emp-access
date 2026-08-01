import { loadConfig } from "./config";
import { sidecarAuthHeaders } from "./auth";

/**
 * Client für den Python-Sidecar (siehe `tracker/main.py`).
 *
 * Der Sidecar läuft typischerweise lokal auf 127.0.0.1:8088 und liefert
 * gerichtete „in/out"-Counter pro Cam mit `peopleCounter.mode == "crossing"`.
 *
 * Wir cachen das Snapshot kurz, um nicht bei jedem Tile-Render neu zu fragen
 * — das Polling-Intervall im Browser (`use-people-counters.ts`) ist 5 s,
 * mehrere Komponenten teilen sich also denselben Cached-Wert.
 */

export interface CrossingCounter {
  mode: "crossing";
  in: number;
  out: number;
  delta: number;
  lastUpdate: number;
  lastError: string | null;
  fps: number;
}

interface SidecarSnapshot {
  counters: Record<string, Omit<CrossingCounter, "mode">>;
}

let cache: { ts: number; data: Record<string, CrossingCounter> } | null = null;
const CACHE_MS = 1500; // Sidecar-Snapshot kurz cachen, eine Quelle der Wahrheit pro 1.5 s

async function getSidecarUrl(): Promise<string> {
  const config = await loadConfig();
  return config.settings.tracker.url.replace(/\/$/, "");
}

export async function fetchCrossingCounters(): Promise<Record<string, CrossingCounter>> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_MS) return cache.data;

  const data: Record<string, CrossingCounter> = {};
  try {
    const url = `${await getSidecarUrl()}/counters`;
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 1500);
    try {
      const r = await fetch(url, {
        signal: ctl.signal,
        cache: "no-store",
        headers: await sidecarAuthHeaders(),
      });
      if (r.ok) {
        const json = (await r.json()) as SidecarSnapshot;
        for (const [camId, c] of Object.entries(json.counters ?? {})) {
          data[camId] = { mode: "crossing", ...c };
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Sidecar nicht erreichbar — wir liefern einfach nichts; UI fällt
    // dann auf „noch keine Daten" zurück. Loggen erschlägt sonst die Logs.
  }

  cache = { ts: now, data };
  return data;
}

export interface CrossingEvent {
  /** Unix-Zeit in Millisekunden. */
  ts: number;
  dir: "in" | "out";
}

/**
 * Einzelne Durchgänge einer Cam, neueste zuerst. Der Sidecar liest sie aus
 * seiner JSONL-Historie, sie überleben also einen Neustart.
 */
export async function fetchRecentCrossings(
  camId: string,
  limit: number,
): Promise<CrossingEvent[]> {
  const url = `${await getSidecarUrl()}/counters/${encodeURIComponent(camId)}/recent?limit=${limit}`;
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: await sidecarAuthHeaders(),
    });
    if (!r.ok) throw new Error(`Sidecar HTTP ${r.status}`);
    const json = (await r.json()) as { events?: unknown };
    const list = Array.isArray(json.events) ? json.events : [];
    return list
      .map((e) => e as Record<string, unknown>)
      .filter((e) => typeof e.ts === "number" && (e.dir === "in" || e.dir === "out"))
      .map((e) => ({ ts: e.ts as number, dir: e.dir as "in" | "out" }));
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifySidecarConfigChanged(): Promise<void> {
  // Cache invalidieren, damit der nächste GET frisch zieht
  cache = null;
  try {
    const url = `${await getSidecarUrl()}/reload`;
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 2000);
    try {
      await fetch(url, {
        method: "POST",
        signal: ctl.signal,
        headers: await sidecarAuthHeaders(),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Sidecar offline ist kein Fehler — kommt beim nächsten Start nach.
  }
}
