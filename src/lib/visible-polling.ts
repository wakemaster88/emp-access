/**
 * Polling, das im Hintergrund-Tab pausiert (Muster wie
 * `components/audio/use-audio-status.ts`): Solange `document.hidden` gilt,
 * läuft kein Takt. Wird der Tab wieder sichtbar, läuft `fn` sofort einmal
 * und der Takt beginnt neu. Ohne React, damit es sich prüfen lässt; der Hook
 * dazu ist `hooks/use-visible-polling.ts`.
 */

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface VisiblePollingOptions {
  /** `false`: beim Start nicht sofort abrufen (der erste Abruf kommt anderswoher). */
  runOnStart?: boolean;
  /** Nur für Tests; sonst `document`. */
  source?: VisibilitySource;
}

/** Startet das Polling; die Rückgabe beendet es. */
export function startVisiblePolling(fn: () => void, ms: number, options: VisiblePollingOptions = {}): () => void {
  const source = options.source ?? document;
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (!timer) timer = setInterval(fn, ms);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (source.hidden) {
      stop();
    } else if (!timer) {
      fn();
      start();
    }
  };

  if (options.runOnStart !== false) fn();
  if (!source.hidden) start();
  source.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    source.removeEventListener("visibilitychange", onVisibility);
  };
}
