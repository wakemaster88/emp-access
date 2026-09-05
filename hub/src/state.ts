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

/** Bereich, aus dem ein Ereignis stammt (Filter im Dashboard). */
export type HubEventKind =
  | "camera"
  | "person"
  | "vehicle"
  | "doorbird"
  | "network"
  | "system"
  | "task";

export type HubEventSeverity = "info" | "warn" | "alert";

export interface HubEvent {
  /** Monoton steigend – der Client laedt nur Neues (`?since=`). */
  seq: number;
  ts: string;
  kind: HubEventKind;
  severity: HubEventSeverity;
  /** Ort: Kameraname, Host, Modul. */
  where: string | null;
  title: string;
  detail?: string;
  score?: number;
  plate?: string;
  listed?: boolean;
}

/** Systemzustand des Hub-Macs (Auto-Login, Ruhezustand, Einschaltplan) – system-setup.ts. */
export interface SystemState {
  checkedAt: string;
  /** Benutzer der automatischen Anmeldung, null = aus. */
  autoLoginUser: string | null;
  /** Minuten bis Ruhezustand laut pmset, 0 = nie, null = unbekannt. */
  sleepMinutes: number | null;
  autorestart: boolean | null;
  /** Taeglicher Einschaltplan laut `pmset -g sched`, null = keiner. */
  powerOnSchedule: string | null;
  /** caffeinate laeuft und haelt den Mac wach, solange der Hub lebt. */
  caffeinate: boolean;
  /** sudoers-Regel fuer pmset vorhanden (install/setup-system.sh). */
  sudoPmset: boolean;
  /** Einstellungen in diesem Lauf per pmset nachgezogen. */
  applied: boolean;
  hints: string[];
}

const MAX_LOGS = 200;
const MAX_TASKS = 50;
const MAX_EVENTS = 300;

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
  face: { ready: false, gallery: 0 },
  alpr: { ready: false },
  parking: {
    lastAt: null as string | null,
    trackerOnline: false,
    lots: 0,
  },
  pendingTasks: 0,
  system: null as SystemState | null,
  improve: {
    since: new Date().toISOString(),
    counts: {} as Record<string, number>,
    hints: [] as string[],
    summary: "noch keine Ereignisse",
    hint: "sammelt …",
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
  const wasOk = STATE.heartbeat.lastError === null;
  STATE.heartbeat.lastAttemptAt = now;
  if (ok) {
    STATE.heartbeat.lastSuccessAt = now;
    STATE.heartbeat.lastError = null;
    STATE.heartbeat.successCount++;
  } else {
    STATE.heartbeat.lastError = error ?? "Unbekannter Fehler";
    STATE.heartbeat.failCount++;
  }
  // Nur Flanken melden, sonst flutet der 30-s-Takt die Timeline.
  if (ok !== wasOk) {
    recordHubEvent({
      kind: "system",
      severity: ok ? "info" : "warn",
      where: "Cloud",
      title: ok ? "Cloud wieder erreichbar" : "Cloud nicht erreichbar",
      detail: ok ? undefined : STATE.heartbeat.lastError ?? undefined,
    });
  }
}

export function recordTask(entry: Omit<TaskHistoryEntry, "ts">) {
  STATE.tasks.unshift({ ts: new Date().toISOString(), ...entry });
  if (STATE.tasks.length > MAX_TASKS) STATE.tasks.length = MAX_TASKS;
  recordHubEvent({
    kind: "task",
    severity: entry.success ? "info" : "warn",
    where: null,
    title: `${entry.type} ${entry.success ? "OK" : "fehlgeschlagen"}`,
    detail: entry.error ?? undefined,
  });
}

/* ---------------------------------------------------------------------------
 * Ereignisring: kurze Chronik dessen, was wo passiert ist (Dashboard-Timeline).
 * Bewusst nur im Speicher – die Langzeitspur liegt in improve.jsonl.
 * ------------------------------------------------------------------------- */

const events: HubEvent[] = [];
let eventSeq = 0;

export function recordHubEvent(entry: Omit<HubEvent, "seq" | "ts">): void {
  events.push({ seq: ++eventSeq, ts: new Date().toISOString(), ...entry });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Hoechste vergebene Sequenznummer (fuer Delta-Polling im Dashboard). */
export function currentEventSeq(): number {
  return eventSeq;
}

export function hubEventsSince(
  since: number,
  filter?: { kind?: string; where?: string; limit?: number }
): HubEvent[] {
  let out = since > 0 ? events.filter((e) => e.seq > since) : events.slice();
  if (filter?.kind) out = out.filter((e) => e.kind === filter.kind);
  if (filter?.where) out = out.filter((e) => e.where === filter.where);
  const limit = filter?.limit ?? MAX_EVENTS;
  return out.length > limit ? out.slice(out.length - limit) : out;
}
