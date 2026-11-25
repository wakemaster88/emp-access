/**
 * Entprellung der Kamera-Ereignisse fuer Cloud, Regeln und Lagebild.
 *
 * Die Reolink-KI flackert: PERSON/VEHICLE gehen fuer einen Poll aus und
 * sofort wieder an. Ohne Nachlauf wurde daraus jedes Mal ein neues
 * Ereignis (Cloud-Eintrag, Regel-Ausloesung, Ueberwachungs-Push). Ein
 * Ereignis endet deshalb erst, wenn der Alarm `holdMs` lang durchgehend
 * aus war; das Ende traegt den Zeitpunkt der letzten aktiven Messung.
 *
 * Die Bild-Pipelines (Gesicht, Kennzeichen) haengen weiter an den rohen
 * Flanken, damit ein zweiter Wagen direkt dahinter nicht verloren geht.
 */

export interface DebounceState {
  /** Ereignis ist gemeldet (start gesendet, end noch nicht). */
  reported: Record<string, boolean>;
  /** Letzter Poll, in dem der Alarm aktiv war (ms). */
  lastActiveAt: Record<string, number>;
  /** Beginn des gemeldeten, noch laufenden Ereignisses (ms). */
  since: Record<string, number>;
}

export interface DebouncedEvent {
  type: string;
  phase: "start" | "end";
  at: number;
}

export function newDebounceState(): DebounceState {
  return { reported: {}, lastActiveAt: {}, since: {} };
}

/** Was fuer diese Kamera gerade als laufend gemeldet ist, mit seinem Beginn. */
export function runningOf(st: DebounceState): Array<{ type: string; at: number }> {
  const out: Array<{ type: string; at: number }> = [];
  for (const [type, on] of Object.entries(st.reported)) {
    const at = st.since[type];
    if (on && at !== undefined) out.push({ type, at });
  }
  return out;
}

/**
 * Die Kamera wird nicht mehr abgefragt (entfernt oder deaktiviert): Was noch
 * als laufend gemeldet ist, endet mit seiner letzten aktiven Messung. Der
 * Zustand ist danach leer.
 */
export function endAll(st: DebounceState): DebouncedEvent[] {
  const out: DebouncedEvent[] = [];
  for (const [type, on] of Object.entries(st.reported)) {
    if (!on) continue;
    out.push({ type, phase: "end", at: st.lastActiveAt[type] ?? st.since[type] ?? 0 });
  }
  st.reported = {};
  st.since = {};
  return out.filter((e) => e.at > 0);
}

/**
 * Neue Messung einspielen. `states` enthaelt nur Typen, die in diesem Poll
 * gemessen wurden; fehlende Typen (z. B. KI-Abfrage fehlgeschlagen) bleiben
 * unveraendert. `holdMs` gilt fuer alle Typen oder wird je Typ erfragt
 * (Bewegung laeuft laenger nach als die KI-Alarme).
 */
export function debounceEvents(
  st: DebounceState,
  states: Record<string, boolean>,
  now: number,
  holdMs: number | ((type: string) => number)
): DebouncedEvent[] {
  const out: DebouncedEvent[] = [];
  for (const [type, active] of Object.entries(states)) {
    const was = st.reported[type] ?? false;
    if (active) {
      st.lastActiveAt[type] = now;
      if (!was) {
        st.reported[type] = true;
        st.since[type] = now;
        out.push({ type, phase: "start", at: now });
      }
    } else if (was) {
      const last = st.lastActiveAt[type] ?? now;
      const hold = typeof holdMs === "function" ? holdMs(type) : holdMs;
      if (now - last >= hold) {
        st.reported[type] = false;
        delete st.since[type];
        out.push({ type, phase: "end", at: last });
      }
    }
  }
  return out;
}
