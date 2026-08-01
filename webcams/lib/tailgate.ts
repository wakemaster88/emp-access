import { loadConfig } from "./config";
import { fetchRecentCrossings } from "./people-tracker";
import { fetchScanRows, type ScanRow } from "./emp-access-scans";
import { getSnapshot } from "./reolink-control";
import { logEvent } from "./audit";
import { notify } from "./notify";
import type { Cam } from "./types";

/**
 * Drehkreuz-Kontrolle: „gehen hier mehr Leute durch, als gültige Scans
 * vorliegen?"
 *
 * Zwei Quellen laufen zusammen:
 *   - Durchgänge  — der Python-Sidecar zählt sie an der Zähllinie der Cam
 *   - Scans       — emp-access liefert jeden Zutrittsversuch mit Ergebnis
 *
 * Verglichen wird über ein gleitendes Fenster, nicht Person für Person.
 * Eine Kamerazählung liegt immer ein paar Prozent daneben, und zwischen
 * Scan und Durchgang liegen je nach Andrang zwei bis zwanzig Sekunden —
 * eine 1:1-Zuordnung würde dauernd Fehlalarme werfen. Erst wenn im Fenster
 * anhaltend mehr Durchgänge als Scans stehen, ist das ein echtes Signal:
 * jemand klettert drüber, oder das breite Tor wird durchgereicht.
 *
 * Der Ablauf startet lazy beim ersten Zugriff und läuft dann im Intervall
 * weiter, analog zu `people-counter.ts`.
 */

const EVAL_INTERVAL_MS = 20_000;
/** Scans werden für alle Geräte gemeinsam geliefert — großzügig holen. */
const SCAN_FETCH_LIMIT = 300;
const CROSSING_FETCH_LIMIT = 500;
const MAX_ALARMS = 50;

export interface TailgateAlarm {
  id: string;
  ts: number;
  camId: string;
  camName: string;
  /** Durchgänge im Fenster. */
  crossings: number;
  /** Gültige Scans im Fenster. */
  scans: number;
  /** Ungedeckte Durchgänge. */
  diff: number;
  windowSec: number;
}

export interface TailgateStatus {
  camId: string;
  checkedAt: number;
  crossings: number;
  scans: number;
  diff: number;
  tolerance: number;
  /**
   * Tatsächlich verglichener Zeitraum. Kann kürzer als `windowSec` sein,
   * wenn die Cloud nicht so weit zurückreicht — siehe `effectiveStart`.
   */
  windowSec: number;
  lastError: string | null;
  lastAlarmAt: number;
}

interface State {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  status: Map<string, TailgateStatus>;
  lastAlarmAt: Map<string, number>;
  alarms: TailgateAlarm[];
}

declare global {
  // eslint-disable-next-line no-var
  var __webcams_tailgate: State | undefined;
}

function getState(): State {
  if (!globalThis.__webcams_tailgate) {
    globalThis.__webcams_tailgate = {
      timer: null,
      running: false,
      status: new Map(),
      lastAlarmAt: new Map(),
      alarms: [],
    };
  }
  return globalThis.__webcams_tailgate;
}

/**
 * Wertet eine Kamera aus. Getrennt von der Schleife, damit der Admin-Test
 * dieselbe Rechnung ohne Alarm auslösen kann.
 */
export async function evaluateCam(
  cam: Cam,
  scans: ScanRow[],
): Promise<Omit<TailgateStatus, "lastAlarmAt">> {
  const tg = cam.tailgate;
  const now = Date.now();
  let windowStart = now - tg.windowSec * 1000;

  const devices = new Set(tg.deviceIds);
  const relevant = scans
    .filter((s) => s.deviceId !== null && devices.has(s.deviceId))
    .sort((a, b) => a.ts - b.ts);

  // Die Cloud liefert die letzten N Scans über alle Geräte hinweg. Reicht
  // das nicht bis zum Fensteranfang zurück, fehlen uns Scans — dann würden
  // wir Durchgänge als ungedeckt melden, die längst bezahlt sind. Also das
  // Fenster auf den Bereich kürzen, den wir wirklich kennen.
  const oldestKnown = scans.length > 0 ? Math.min(...scans.map((s) => s.ts)) : null;
  if (oldestKnown !== null && oldestKnown > windowStart) {
    windowStart = oldestKnown;
  }

  const crossingEvents = await fetchRecentCrossings(cam.id, CROSSING_FETCH_LIMIT);
  const crossings = crossingEvents.filter(
    (e) => e.dir === tg.countDirection && e.ts >= windowStart && e.ts <= now,
  ).length;

  const granted = relevant.filter(
    (s) => s.result === "GRANTED" && s.ts >= windowStart && s.ts <= now,
  ).length;

  return {
    camId: cam.id,
    checkedAt: now,
    crossings,
    scans: granted,
    diff: crossings - granted,
    tolerance: tg.tolerance,
    windowSec: Math.round((now - windowStart) / 1000),
    lastError: null,
  };
}

async function raiseAlarm(cam: Cam, st: Omit<TailgateStatus, "lastAlarmAt">) {
  const state = getState();
  const alarm: TailgateAlarm = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ts: Date.now(),
    camId: cam.id,
    camName: cam.name,
    crossings: st.crossings,
    scans: st.scans,
    diff: st.diff,
    windowSec: st.windowSec,
  };
  state.alarms.unshift(alarm);
  if (state.alarms.length > MAX_ALARMS) state.alarms.length = MAX_ALARMS;
  state.lastAlarmAt.set(cam.id, alarm.ts);

  await logEvent({
    action: "tailgate-alarm",
    target: cam.id,
    ok: false,
    meta: {
      crossings: st.crossings,
      scans: st.scans,
      diff: st.diff,
      windowSec: st.windowSec,
    },
  });

  let snapshot: Buffer | null = null;
  try {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 8000);
    try {
      snapshot = await getSnapshot(cam, { signal: ctl.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.warn("[tailgate] snapshot failed", (e as Error).message);
  }

  void notify({
    type: "tailgate",
    data: {
      camName: cam.name,
      crossings: st.crossings,
      scans: st.scans,
      diff: st.diff,
      windowSec: st.windowSec,
      snapshot,
    },
  });
}

async function tick() {
  const state = getState();
  if (state.running) return;
  state.running = true;
  try {
    const cfg = await loadConfig();
    const cams = cfg.cams.filter(
      (c) =>
        c.enabled &&
        c.tailgate.enabled &&
        c.peopleCounter.enabled &&
        c.peopleCounter.mode === "crossing" &&
        c.tailgate.deviceIds.length > 0,
    );

    for (const id of state.status.keys()) {
      if (!cams.some((c) => c.id === id)) state.status.delete(id);
    }
    if (cams.length === 0) return;

    const emp = cfg.settings.empAccess;
    const token = emp.apiToken?.trim() ?? "";
    if (!emp.enabled || !token) {
      for (const cam of cams) {
        state.status.set(cam.id, {
          camId: cam.id,
          checkedAt: Date.now(),
          crossings: 0,
          scans: 0,
          diff: 0,
          tolerance: cam.tailgate.tolerance,
          windowSec: 0,
          lastError: "emp-access ist nicht eingerichtet",
          lastAlarmAt: state.lastAlarmAt.get(cam.id) ?? 0,
        });
      }
      return;
    }

    // Ein Cloud-Abruf für alle Kameras — die Scans kommen ohnehin gemeinsam.
    let scans: ScanRow[];
    try {
      scans = await fetchScanRows(emp.baseUrl, token, SCAN_FETCH_LIMIT);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan-Abruf fehlgeschlagen";
      for (const cam of cams) {
        const prev = state.status.get(cam.id);
        state.status.set(cam.id, {
          ...(prev ?? {
            camId: cam.id,
            crossings: 0,
            scans: 0,
            diff: 0,
            tolerance: cam.tailgate.tolerance,
            windowSec: 0,
            lastAlarmAt: 0,
          }),
          camId: cam.id,
          checkedAt: Date.now(),
          lastError: msg,
          lastAlarmAt: state.lastAlarmAt.get(cam.id) ?? 0,
        });
      }
      return;
    }

    for (const cam of cams) {
      try {
        const st = await evaluateCam(cam, scans);
        const lastAlarmAt = state.lastAlarmAt.get(cam.id) ?? 0;
        state.status.set(cam.id, { ...st, lastAlarmAt });

        const cooledDown =
          Date.now() - lastAlarmAt >= cam.tailgate.cooldownSec * 1000;
        if (st.diff >= cam.tailgate.tolerance && cooledDown) {
          await raiseAlarm(cam, st);
          const updated = state.status.get(cam.id);
          if (updated) updated.lastAlarmAt = Date.now();
        }
      } catch (e) {
        state.status.set(cam.id, {
          camId: cam.id,
          checkedAt: Date.now(),
          crossings: 0,
          scans: 0,
          diff: 0,
          tolerance: cam.tailgate.tolerance,
          windowSec: 0,
          lastError: e instanceof Error ? e.message : "Auswertung fehlgeschlagen",
          lastAlarmAt: state.lastAlarmAt.get(cam.id) ?? 0,
        });
      }
    }
  } finally {
    state.running = false;
  }
}

export function ensureTailgateStarted() {
  const state = getState();
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), EVAL_INTERVAL_MS);
  void tick();
}

export function getTailgateSnapshot(): {
  status: TailgateStatus[];
  alarms: TailgateAlarm[];
} {
  const state = getState();
  return {
    status: [...state.status.values()],
    alarms: state.alarms,
  };
}
