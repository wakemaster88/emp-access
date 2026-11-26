/**
 * Tor offen halten (DoorBird): Das Tor schliesst ~1 min nach jedem
 * Tueroeffner-Impuls von selbst. Fuer "offen halten" loest der Hub das Relais
 * bis `doorHoldUntil` im Takt erneut aus. Die Cloud haelt den Zielzustand
 * (Camera.doorHoldUntil), der Hub meldet jeden Impuls zurueck und liest den
 * Zielzustand aus der Antwort (holdPulseAnswer).
 */

/** Laengste Offenhaltung in Minuten (Schutz gegen vergessene Tore). */
export const DOOR_HOLD_MAX_MINUTES = 12 * 60;

/** Auswahl im Dialog (Minuten). */
export const DOOR_HOLD_PRESETS: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: "15 Minuten" },
  { minutes: 30, label: "30 Minuten" },
  { minutes: 60, label: "1 Stunde" },
  { minutes: 120, label: "2 Stunden" },
  { minutes: 240, label: "4 Stunden" },
  { minutes: 480, label: "8 Stunden" },
];

export interface DoorHoldState {
  /** Bis wann offen gehalten wird (ISO), null = aus. */
  until: string | null;
  /** Letzter erfolgreicher Impuls des Hubs (ISO). */
  pulseAt: string | null;
  /** Fehler des letzten Impulses, null = ok. */
  error: string | null;
}

export function doorHoldState(camera: {
  doorHoldUntil: Date | null;
  doorHoldPulseAt: Date | null;
  doorHoldError: string | null;
}): DoorHoldState {
  return {
    until: camera.doorHoldUntil?.toISOString() ?? null,
    pulseAt: camera.doorHoldPulseAt?.toISOString() ?? null,
    error: camera.doorHoldError,
  };
}

/** Aktiv = Endzeitpunkt liegt in der Zukunft. */
export function isDoorHoldActive(state: Pick<DoorHoldState, "until">, now = Date.now()): boolean {
  if (!state.until) return false;
  const t = new Date(state.until).getTime();
  return Number.isFinite(t) && t > now;
}

/** Minuten aus dem Request pruefen: ganze Zahl 1..DOOR_HOLD_MAX_MINUTES. */
export function parseDoorHoldMinutes(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > DOOR_HOLD_MAX_MINUTES) return null;
  return n;
}

/**
 * Antwort auf die Impuls-Meldung des Hubs (/api/hub/cameras/[id]/door-hold):
 * `until` ist der Zielzustand nach der Meldung, null = kein Offenhalten. Der
 * Hub beendet bei null oder einem vergangenen Zeitpunkt und uebernimmt einen
 * anderen Endzeitpunkt (hub/src/hold-rules.ts afterReport).
 */
export function holdPulseAnswer(doorHoldUntil: Date | null): { ok: true; until: string | null } {
  return { ok: true, until: doorHoldUntil?.toISOString() ?? null };
}

/**
 * Zielzustand zu einem Auftrag DOORBIRD_HOLD, der ueber POST /api/hub/tasks
 * kommt, so wie der Hub den Auftrag liest: payload.until als Zeitpunkt in der
 * Zukunft = bis dahin offen halten, alles andere = beenden (null). Die
 * Obergrenze prueft vorher doorHoldUntilError (hub-task-rules.ts). Damit
 * stimmt Camera.doorHoldUntil mit dem Auftrag ueberein, und die Antwort auf
 * die Impuls-Meldung beendet ein so gestartetes Offenhalten nicht.
 */
export function doorHoldUntilOfTask(payload: unknown, now: Date = new Date()): Date | null {
  const raw = (payload as { until?: unknown } | null | undefined)?.until;
  if (typeof raw !== "string" || !raw) return null;
  const until = Date.parse(raw);
  if (!Number.isFinite(until) || until <= now.getTime()) return null;
  return new Date(until);
}

/**
 * Feld im Payload eines Auftrags DOORBIRD_HOLD aus POST /api/hub/tasks: der
 * Zielzustand vor dem Auftrag (ISO oder null). Nur ein Start oder eine
 * Verlaengerung traegt es; scheitert der Auftrag, nimmt die Ergebnis-Route
 * den Zielzustand damit zurueck (doorHoldRevert). Der Hub liest es nicht.
 */
export const DOOR_HOLD_BEFORE_FIELD = "holdBefore";

export type DoorHoldTaskPlan =
  /** Keine DoorBird: Camera bleibt unberuehrt, der Hub lehnt den Auftrag ab. */
  | { action: "keiner" }
  | { action: "ablehnen"; error: string }
  /** Zielzustand vor dem Auftrag setzen; `before` ist der bisherige. */
  | { action: "setzen"; until: Date | null; before: Date | null };

/**
 * Auftrag DOORBIRD_HOLD ueber POST /api/hub/tasks, wie
 * /api/cameras/[id]/door-hold: Einen Start oder eine Verlaengerung an eine
 * deaktivierte DoorBird lehnt die Cloud ab, ohne den Zielzustand zu setzen
 * (der Hub kennt sie nicht, und mit dem Einschalten begaenne sonst ein
 * Offenhalten ohne neuen Befehl). Beenden geht immer.
 */
export function doorHoldTaskPlan(
  camera: { kind: string | null; enabled: boolean; doorHoldUntil: Date | null },
  payload: unknown,
  now: Date = new Date()
): DoorHoldTaskPlan {
  if (camera.kind !== "DOORBIRD") return { action: "keiner" };
  const until = doorHoldUntilOfTask(payload, now);
  if (until && !camera.enabled) return { action: "ablehnen", error: "Kamera ist deaktiviert" };
  return { action: "setzen", until, before: camera.doorHoldUntil };
}

/**
 * Payload, wie der Auftrag angelegt wird: Ein Start oder eine Verlaengerung
 * merkt sich den Zielzustand davor (DOOR_HOLD_BEFORE_FIELD), alles andere
 * traegt das Feld nicht, auch wenn der Aufrufer es mitschickt.
 */
export function doorHoldTaskPayload(payload: unknown, plan: DoorHoldTaskPlan): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const rest: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  delete rest[DOOR_HOLD_BEFORE_FIELD];
  if (plan.action !== "setzen" || !plan.until) return rest;
  return { ...rest, [DOOR_HOLD_BEFORE_FIELD]: plan.before?.toISOString() ?? null };
}

/**
 * Ergebnis eines Auftrags DOORBIRD_HOLD: Ist ein Start oder eine
 * Verlaengerung aus POST /api/hub/tasks gescheitert (der Hub kennt die
 * DoorBird nicht), wird der Zielzustand auf den Wert davor zurueckgesetzt,
 * wie es /api/cameras/[id]/door-hold tut. Nur solange Camera.doorHoldUntil
 * noch genau auf dem Wert dieses Auftrags steht: Ein neuerer Auftrag bleibt
 * stehen. null = nichts zurueckzunehmen.
 */
export function doorHoldRevert(
  task: { type: string; payload: unknown },
  success: boolean
): { cameraId: number; until: Date; before: Date | null } | null {
  if (success || task.type !== "DOORBIRD_HOLD") return null;
  const p = task.payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || !(DOOR_HOLD_BEFORE_FIELD in p)) return null;
  const cameraId = Number(p.cameraId);
  const until = typeof p.until === "string" ? Date.parse(p.until) : NaN;
  const rawBefore = p[DOOR_HOLD_BEFORE_FIELD];
  const before = typeof rawBefore === "string" ? Date.parse(rawBefore) : null;
  if (!Number.isInteger(cameraId) || cameraId <= 0 || !Number.isFinite(until)) return null;
  if (before !== null && !Number.isFinite(before)) return null;
  return { cameraId, until: new Date(until), before: before === null ? null : new Date(before) };
}
