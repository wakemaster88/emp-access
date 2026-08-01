"use client";

/**
 * Geteilte SSE-Verbindung zu `/api/events` für Drehkreuz-Sofortmeldungen.
 *
 * Gleiches Muster wie bei der Klingel: genau eine Verbindung, solange
 * mindestens ein Subscriber aktiv ist, Reconnect mit 3-s-Backoff.
 */

export interface TailgatePass {
  camId: string;
  camName: string;
  crossedAt: number;
  count: number;
}

type PassListener = (ev: TailgatePass) => void;

const listeners = new Set<PassListener>();
let es: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function ensureConnection() {
  if (es || listeners.size === 0) return;
  es = new EventSource("/api/events");
  es.addEventListener("tailgate-pass", (e) => {
    let data: TailgatePass;
    try {
      data = JSON.parse((e as MessageEvent).data) as TailgatePass;
    } catch {
      return;
    }
    for (const l of listeners) l(data);
  });
  es.onerror = () => {
    es?.close();
    es = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      ensureConnection();
    }, 3000);
  };
}

function teardownIfIdle() {
  if (listeners.size > 0) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  es?.close();
  es = null;
}

export function subscribeTailgatePass(listener: PassListener): () => void {
  listeners.add(listener);
  ensureConnection();
  return () => {
    listeners.delete(listener);
    teardownIfIdle();
  };
}
