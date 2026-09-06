/**
 * Tor offen halten (DoorBird): Das Tor schliesst ~1 min nach jedem
 * Tueroeffner-Impuls von selbst. Fuer "offen halten" loest der Hub das Relais
 * bis `doorHoldUntil` im Takt erneut aus. Die Cloud haelt den Zielzustand
 * (Camera.doorHoldUntil), der Hub meldet jeden Impuls zurueck.
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
