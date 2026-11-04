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
}

export interface DebouncedEvent {
  type: string;
  phase: "start" | "end";
  at: number;
}

export function newDebounceState(): DebounceState {
  return { reported: {}, lastActiveAt: {} };
}

/**
 * Neue Messung einspielen. `states` enthaelt nur Typen, die in diesem Poll
 * gemessen wurden; fehlende Typen (z. B. KI-Abfrage fehlgeschlagen) bleiben
 * unveraendert.
 */
export function debounceEvents(
  st: DebounceState,
  states: Record<string, boolean>,
  now: number,
  holdMs: number
): DebouncedEvent[] {
  const out: DebouncedEvent[] = [];
  for (const [type, active] of Object.entries(states)) {
    const was = st.reported[type] ?? false;
    if (active) {
      st.lastActiveAt[type] = now;
      if (!was) {
        st.reported[type] = true;
        out.push({ type, phase: "start", at: now });
      }
    } else if (was) {
      const last = st.lastActiveAt[type] ?? now;
      if (now - last >= holdMs) {
        st.reported[type] = false;
        out.push({ type, phase: "end", at: last });
      }
    }
  }
  return out;
}
