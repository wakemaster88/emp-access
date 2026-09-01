import { sidecarAuthHeaders } from "./auth";
import { loadConfig } from "./config";
import { getSnapshot } from "./reolink-control";
import type { Cam } from "./types";

/**
 * People-Counter Presence-Modus: Snapshot → YOLO-Tracker POST /classify.
 *
 * Pro Cam mit `peopleCounter.enabled && peopleCounter.mode === "presence"`
 * läuft im Server-Prozess ein Polling-Worker, der in `intervalSec`-Abständen
 * einen Snapshot holt und die Personenzahl vom Tracker bekommt.
 * Crossing/Zone laufen weiter im Python-Sidecar (Stream).
 *
 * Für gerichtetes Zählen (rein/raus) siehe `lib/people-tracker.ts` —
 * das wird vom Python-Sidecar übernommen, weil ein LLM auf einzelnen
 * Snapshots keine Track-Identität über die Zeit hält.
 *
 * Der Workflow startet **lazy** beim ersten Zugriff auf
 * `getCounter()` / `getAllCounters()` — also typischerweise wenn das
 * Dashboard das erste Mal die Config holt.
 *
 * In-Memory-State geht beim Server-Reload verloren — das ist okay,
 * weil die Counter ja bei jedem Polling-Tick frisch ermittelt werden.
 */

interface CounterEntry {
  camId: string;
  count: number | null;
  lastUpdate: number; // ts ms
  lastError?: string;
  history: { ts: number; count: number }[];
}

interface Worker {
  timer: ReturnType<typeof setInterval>;
  intervalMs: number;
}

interface State {
  counters: Map<string, CounterEntry>;
  workers: Map<string, Worker>;
  starting: Set<string>;
  initialized: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __webcams_people_counter: State | undefined;
}

const HISTORY_LIMIT = 60; // letzte ~60 Werte

function getState(): State {
  if (!globalThis.__webcams_people_counter) {
    globalThis.__webcams_people_counter = {
      counters: new Map(),
      workers: new Map(),
      starting: new Set(),
      initialized: false,
    };
  }
  return globalThis.__webcams_people_counter;
}

/**
 * Bringt das gesamte Worker-Set in Einklang mit der aktuellen Config:
 * - Cams mit `peopleCounter.enabled` und ohne Worker → Worker starten
 * - Worker für deaktivierte / nicht mehr existierende Cams → stoppen
 * - Worker mit anderem `intervalSec` → neu starten
 *
 * Wird idempotent aufgerufen — z.B. beim ersten Server-Request und
 * nach jeder Config-Änderung.
 */
export async function syncWorkers() {
  const state = getState();
  const config = await loadConfig();
  // Nur Cams im Presence-Modus laufen hier — `crossing` macht der Sidecar.
  const enabled = config.cams.filter(
    (c) => c.enabled && c.peopleCounter.enabled && c.peopleCounter.mode === "presence",
  );
  const wantedIds = new Set(enabled.map((c) => c.id));

  // 1) Worker stoppen, die nicht mehr gewollt sind
  for (const [camId, worker] of state.workers) {
    if (!wantedIds.has(camId)) {
      clearInterval(worker.timer);
      state.workers.delete(camId);
    }
  }

  // Auch verwaiste Counter-Einträge wegräumen, damit das UI nichts Stales
  // anzeigt, wenn eine Cam deaktiviert wurde.
  for (const camId of state.counters.keys()) {
    if (!wantedIds.has(camId)) {
      state.counters.delete(camId);
    }
  }

  // 2) Worker (re-)starten für gewollte Cams
  for (const cam of enabled) {
    const intervalMs = cam.peopleCounter.intervalSec * 1000;
    const existingWorker = state.workers.get(cam.id);

    // Intervall wird im Worker-Eintrag mitgeführt — bei Änderung von
    // `intervalSec` stoppen wir den alten Timer und starten frisch.
    const intervalChanged =
      !!existingWorker && existingWorker.intervalMs !== intervalMs;

    if (existingWorker && !intervalChanged) continue;
    if (existingWorker) clearInterval(existingWorker.timer);

    if (!state.counters.has(cam.id)) {
      state.counters.set(cam.id, {
        camId: cam.id,
        count: null,
        lastUpdate: 0,
        history: [],
      });
    }

    // Sofortiger erster Tick + dann Intervall
    void tickOnce(cam.id);
    const timer = setInterval(() => {
      void tickOnce(cam.id);
    }, intervalMs);
    state.workers.set(cam.id, { timer, intervalMs });
  }

  state.initialized = true;
}

async function tickOnce(camId: string) {
  const state = getState();
  if (state.starting.has(camId)) return;
  state.starting.add(camId);
  try {
    const config = await loadConfig();
    const cam = config.cams.find((c) => c.id === camId);
    if (
      !cam ||
      !cam.peopleCounter.enabled ||
      !cam.enabled ||
      cam.peopleCounter.mode !== "presence"
    ) {
      return;
    }
    const count = await analyseCamSnapshot(cam, config.settings.tracker.url);
    const entry = state.counters.get(camId);
    if (!entry) return;
    entry.count = count;
    entry.lastUpdate = Date.now();
    entry.lastError = undefined;
    entry.history.push({ ts: entry.lastUpdate, count });
    while (entry.history.length > HISTORY_LIMIT) entry.history.shift();
  } catch (err) {
    const entry = state.counters.get(camId);
    if (entry) {
      entry.lastError = (err as Error).message;
      entry.lastUpdate = Date.now();
    }
  } finally {
    state.starting.delete(camId);
  }
}

/** Holt einen Snapshot und zählt Personen über den YOLO-Tracker. */
async function analyseCamSnapshot(cam: Cam, trackerUrl: string): Promise<number> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 8_000);
  try {
    const buf = await getSnapshot(cam, { signal: ctl.signal });
    const r = await fetch(`${trackerUrl.replace(/\/$/, "")}/classify`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        ...(await sidecarAuthHeaders()),
      },
      body: new Uint8Array(buf),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`tracker classify HTTP ${r.status}`);
    const data = (await r.json()) as { people?: number };
    const n = Number(data.people);
    if (!Number.isFinite(n) || n < 0 || n > 200) {
      throw new Error(`unplausibel: ${n}`);
    }
    return Math.round(n);
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureWorkersStarted() {
  const state = getState();
  if (state.initialized) return;
  await syncWorkers();
}

export function getCounter(camId: string): CounterEntry | null {
  return getState().counters.get(camId) ?? null;
}

export function getAllCounters(): Record<string, CounterEntry> {
  const out: Record<string, CounterEntry> = {};
  for (const [k, v] of getState().counters) out[k] = v;
  return out;
}

/**
 * Manueller Trigger: lädt sofort einen frischen Wert für die Cam,
 * unabhängig vom Polling-Tick. Genutzt vom Admin „Jetzt zählen"-Button.
 */
export async function triggerNow(camId: string) {
  await tickOnce(camId);
  return getCounter(camId);
}
