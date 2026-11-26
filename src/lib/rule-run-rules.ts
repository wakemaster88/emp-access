/**
 * Ergebnis eines Regel-Laufs (RoomRuleRun): Erfolg, Fehlertext und Aktionen,
 * die an den Hub uebergeben sind.
 *
 * Rein und ohne Abhaengigkeiten, damit auch die Oberflaeche es importieren
 * kann. Benutzt von `executeRule` in room-rules.ts, der Ergebnis-Route der
 * Hub-Auftraege und der Regel-Seite.
 *
 * Hue und „Kamera steuern“ laufen als Hub-Auftrag: Beim Lauf steht nur fest,
 * dass der Auftrag angelegt ist („an Hub uebergeben“, mit Auftragsnummer).
 * Erfolg zeigt der Verlauf erst, wenn der Hub das Ergebnis meldet; ein
 * gescheiterter oder verfallener Auftrag zaehlt als Fehlschlag.
 */

/** Fehlertext, wenn ein Geraet den Befehl ohne eigene Begruendung nicht annahm. */
export const NOT_ACCEPTED_ERROR = "Gerät hat den Befehl nicht angenommen";

/** So heisst eine Aktion im Verlauf, solange der Hub-Auftrag offen ist. */
export const HANDED_OVER_LABEL = "an Hub übergeben";

/** Eine Aktion in `RoomRuleRun.details`, so weit hier gebraucht. */
export interface RunDetail {
  actionId?: number;
  kind?: string;
  target?: string;
  ok?: boolean;
  error?: string;
  /** Hub-Auftrag (HubTask.id), wenn die Aktion an den Hub uebergeben wurde. */
  hubTaskId?: number;
  /** Hub-Auftrag noch ohne Ergebnis. */
  pending?: boolean;
  [extra: string]: unknown;
}

/** Stand eines Hub-Auftrags (HubTask). */
export interface HubTaskState {
  status: string;
  error: string | null;
}

/** Text fuer Auftraege, die verfallen sind, bevor der Hub sie abholte (hub-task-rules.ts). */
const EXPIRED = "abgelaufen";

function asDetails(raw: unknown): RunDetail[] {
  return Array.isArray(raw) ? (raw.filter((d) => d && typeof d === "object") as RunDetail[]) : [];
}

/** Nummern der Hub-Auftraege, deren Ergebnis noch aussteht. */
export function pendingHubTaskIds(raw: unknown): number[] {
  return asDetails(raw)
    .filter((d) => d.pending === true && typeof d.hubTaskId === "number")
    .map((d) => d.hubTaskId as number);
}

/**
 * Erfolg und Fehlertext eines Laufs aus seinen Aktionen: Erfolg nur, wenn
 * jede Aktion gelang und kein Hub-Auftrag mehr offen ist. Offene Auftraege
 * sind kein Fehler und stehen nicht im Fehlertext.
 */
export function runOutcome(raw: unknown): { success: boolean; errorMessage: string | null; pending: number } {
  const details = asDetails(raw);
  const pending = details.filter((d) => d.pending === true).length;
  const failed = details.filter((d) => d.ok !== true && d.pending !== true);
  return {
    success: details.length > 0 && pending === 0 && failed.length === 0,
    errorMessage: failed.length > 0 ? failed.map((d) => `${d.target ?? "–"}: ${d.error ?? NOT_ACCEPTED_ERROR}`).join("; ") : null,
    pending,
  };
}

/**
 * Offene Hub-Auftraege eines Laufs mit dem Stand der Auftraege abgleichen.
 * DONE: gelungen. FAILED: gescheitert, mit dem Fehler des Hubs (verfallen
 * heisst: nicht rechtzeitig abgeholt). Fehlt der Auftrag (geloescht), zaehlt
 * er als gescheitert. PENDING und RUNNING bleiben offen.
 */
export function settleRunDetails(
  raw: unknown,
  tasks: Map<number, HubTaskState>,
): { details: RunDetail[]; changed: boolean } {
  let changed = false;
  const details = asDetails(raw).map((d) => {
    if (d.pending !== true || typeof d.hubTaskId !== "number") return d;
    const task = tasks.get(d.hubTaskId);
    if (task && task.status !== "DONE" && task.status !== "FAILED") return d;
    changed = true;
    const rest = { ...d };
    delete rest.pending;
    if (task?.status === "DONE") return { ...rest, ok: true };
    const error = !task
      ? "Hub-Auftrag nicht mehr vorhanden"
      : task.error === EXPIRED
        ? "Hub hat den Auftrag nicht rechtzeitig abgeholt"
        : `Hub: ${task.error || "fehlgeschlagen"}`;
    return { ...rest, ok: false, error };
  });
  return { details, changed };
}

/**
 * Stand der Auftraege fuer die Laeufe eines Mandanten: Ein Lauf nennt nur
 * Auftraege seines Mandanten. Fremde gelten als nicht vorhanden.
 */
export function ownHubTasks(
  tasks: Array<{ id: number; accountId: number; status: string; error: string | null }>,
  accountId: number,
): Map<number, HubTaskState> {
  return new Map(tasks.filter((t) => t.accountId === accountId).map((t) => [t.id, { status: t.status, error: t.error }]));
}

/** So viele Aktionen eines Hub-Laufs nimmt der Verlauf hoechstens auf. */
export const HUB_RUN_DETAILS_MAX = 100;

const textField = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;

/**
 * Aktionen eines Laufs, den der Hub meldet (POST /api/hub/rules), fuer den
 * Verlauf: nur die Felder, die der Hub schreibt (outage-rules.ts,
 * `RunDetail`), Texte gekuerzt, hoechstens `HUB_RUN_DETAILS_MAX`. Felder,
 * die die Cloud selbst setzt (Auftragsnummer, offen, Geraet), fallen weg:
 * Ein Hub-Lauf haengt an keinem Auftrag.
 */
export function sanitizeHubRunDetails(raw: unknown): RunDetail[] {
  if (!Array.isArray(raw)) return [];
  const out: RunDetail[] = [];
  for (const d of raw.slice(0, HUB_RUN_DETAILS_MAX)) {
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    const r = d as Record<string, unknown>;
    const actionId = typeof r.actionId === "number" && Number.isSafeInteger(r.actionId) && r.actionId > 0 ? r.actionId : undefined;
    const key = textField(r.key, 200);
    const kind = textField(r.kind, 40);
    const target = textField(r.target, 200);
    const error = textField(r.error, 500);
    const ms = typeof r.ms === "number" && Number.isFinite(r.ms) && r.ms >= 0 ? Math.min(Math.round(r.ms), 86_400_000) : undefined;
    out.push({
      ...(actionId !== undefined ? { actionId } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(target !== undefined ? { target } : {}),
      ok: r.ok === true,
      ...(error !== undefined ? { error } : {}),
      ...(ms !== undefined ? { ms } : {}),
    });
  }
  return out;
}

/** Anzeige-Zustand eines Laufs fuer die Regel-Seite. */
export type RunState = "ok" | "uebergeben" | "fehler";

export function runState(run: { success: boolean; details?: unknown }): RunState {
  if (run.success) return "ok";
  const { pending, errorMessage } = runOutcome(run.details);
  return pending > 0 && !errorMessage ? "uebergeben" : "fehler";
}

// ─── Folgeregeln nach einem Hub-Auftrag ───────────────────────────────────────

/**
 * Ein Hue-Auftrag (HUE_SET), der Regeln „Geraet geschaltet“ ausloest,
 * traegt `switched: { action, depth }`: Die Regeln starten erst, wenn der
 * Hub das Schalten meldet, nicht schon bei der Uebergabe. Kommt das Ergebnis
 * spaeter als so lange nach dem Anlegen, starten sie nicht mehr.
 */
export const SWITCHED_FOLLOW_UP_MAX_MS = 10 * 60_000;

export interface SwitchedFollowUp {
  deviceId: number;
  action: string;
  /** Tiefe fuer `runDeviceSwitchedRules` (Folgeregeln einer Regel: 1). */
  depth: number;
}

/**
 * Folgeregeln aus dem Ergebnis eines Hub-Auftrags: nur bei Erfolg, nur fuer
 * das erste Ergebnis (`wasOpen`: der Auftrag war noch nicht DONE oder
 * FAILED), nur mit `switched` im Auftrag (aeltere Auftraege haben ihre
 * Folgeregeln schon bei der Uebergabe gestartet) und nur rechtzeitig.
 */
export function switchedFollowUp(
  task: { type: string; payload: unknown; createdAt: Date },
  result: { success: boolean; wasOpen: boolean },
  now: Date,
): SwitchedFollowUp | null {
  if (task.type !== "HUE_SET" || !result.success || !result.wasOpen) return null;
  if (now.getTime() - task.createdAt.getTime() > SWITCHED_FOLLOW_UP_MAX_MS) return null;
  const p = task.payload as { deviceId?: unknown; switched?: { action?: unknown; depth?: unknown } } | null;
  const deviceId = Number(p?.deviceId);
  const action = p?.switched?.action;
  const depth = Number(p?.switched?.depth);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return null;
  if (typeof action !== "string" || !/^[a-z_]{2,20}$/.test(action)) return null;
  if (!Number.isInteger(depth) || depth < 0 || depth > 5) return null;
  return { deviceId, action, depth };
}
