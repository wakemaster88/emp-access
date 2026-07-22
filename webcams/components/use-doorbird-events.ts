"use client";

/**
 * Geteilte SSE-Verbindung zu `/api/doorbird/events`.
 *
 * Vorher hatten DoorbirdListener und jede Doorbird-Kachel je eine eigene
 * EventSource — pro Subscriber eine offene HTTP-Verbindung zum Server.
 * Hier gibt es genau EINE Verbindung, solange mindestens ein Subscriber
 * aktiv ist; Reconnect mit 3-s-Backoff; Abbau, wenn der letzte abmeldet.
 */

type RingListener = () => void;

const listeners = new Set<RingListener>();
let es: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function ensureConnection() {
  if (es || listeners.size === 0) return;
  es = new EventSource("/api/doorbird/events");
  es.addEventListener("ring", () => {
    for (const l of listeners) l();
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

/** Meldet einen Ring-Listener an; Rückgabewert ist die Unsubscribe-Funktion. */
export function subscribeRing(listener: RingListener): () => void {
  listeners.add(listener);
  ensureConnection();
  return () => {
    listeners.delete(listener);
    teardownIfIdle();
  };
}
