"use client";

import { useEffect } from "react";
import { startVisiblePolling } from "@/lib/visible-polling";

/**
 * Ruft `fn` alle `ms` Millisekunden auf, solange der Tab sichtbar ist, und
 * sofort einmal beim Zurückkommen (siehe `lib/visible-polling.ts`).
 * `ms = null` schaltet das Polling ab. `fn` bekommt `active()`: false, sobald
 * der Effekt beendet ist (Unmount oder neue Abhängigkeiten), damit eine späte
 * Antwort keinen veralteten Stand setzt. `fn` sollte per `useCallback`
 * stabil sein; ändert es sich, startet das Polling neu (mit sofortigem Abruf,
 * außer bei `runOnStart: false`).
 */
export function useVisiblePolling(
  fn: (active: () => boolean) => unknown,
  ms: number | null,
  options?: { runOnStart?: boolean },
) {
  const runOnStart = options?.runOnStart ?? true;
  useEffect(() => {
    if (ms == null) return;
    let alive = true;
    const active = () => alive;
    const stop = startVisiblePolling(() => void fn(active), ms, { runOnStart });
    return () => {
      alive = false;
      stop();
    };
  }, [fn, ms, runOnStart]);
}
