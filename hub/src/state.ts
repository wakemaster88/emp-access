/**
 * Laufzeit-Status des Hubs fuer das lokale Dashboard.
 * Bewusst ohne Imports aus anderen Hub-Modulen, um Zyklen zu vermeiden.
 */

export interface LogEntry {
  ts: string;
  msg: string;
}

export interface TaskHistoryEntry {
  ts: string;
  id: number;
  type: string;
  success: boolean;
  error?: string;
  result?: unknown;
}

const MAX_LOGS = 200;
const MAX_TASKS = 50;

export const STATE = {
  startedAt: new Date().toISOString(),
  heartbeat: {
    lastAttemptAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastError: null as string | null,
    successCount: 0,
    failCount: 0,
  },
  taskPolls: 0,
  autoScan: {
    lastRunAt: null as string | null,
    devices: 0,
    uploaded: false,
    error: null as string | null,
  },
  cameras: {
    lastPollAt: null as string | null,
    configured: 0,
    reachable: 0,
    openEvents: 0,
    error: null as string | null,
  },
  tasks: [] as TaskHistoryEntry[],
  logs: [] as LogEntry[],
};

export function pushLog(msg: string) {
  STATE.logs.push({ ts: new Date().toISOString(), msg });
  if (STATE.logs.length > MAX_LOGS) STATE.logs.splice(0, STATE.logs.length - MAX_LOGS);
}

export function recordHeartbeat(ok: boolean, error?: string) {
  const now = new Date().toISOString();
  STATE.heartbeat.lastAttemptAt = now;
  if (ok) {
    STATE.heartbeat.lastSuccessAt = now;
    STATE.heartbeat.lastError = null;
    STATE.heartbeat.successCount++;
  } else {
    STATE.heartbeat.lastError = error ?? "Unbekannter Fehler";
    STATE.heartbeat.failCount++;
  }
}

export function recordTask(entry: Omit<TaskHistoryEntry, "ts">) {
  STATE.tasks.unshift({ ts: new Date().toISOString(), ...entry });
  if (STATE.tasks.length > MAX_TASKS) STATE.tasks.length = MAX_TASKS;
}
