/**
 * Pure Entscheidungslogik fürs Tür-Öffnen — getrennt von der Route,
 * damit sie ohne HTTP-Kontext testbar ist.
 */

/** Quellen, die das Ring-Fenster umgehen dürfen (eigene Schutzlogik). */
const TRUSTED_AUTO_SOURCES = new Set(["alpr"]);

export interface DoorOpenDecision {
  allowed: boolean;
  inWindow: boolean;
  /** ms seit letztem Klingeln, -1 wenn nie geklingelt. */
  elapsedMs: number;
  reason?: string;
}

export function evaluateDoorOpen(opts: {
  enforceRingWindow: boolean;
  source: string;
  lastRingAt: number; // 0 = nie
  now: number;
  ringWindowSec: number;
}): DoorOpenDecision {
  const { enforceRingWindow, source, lastRingAt, now, ringWindowSec } = opts;
  const elapsedMs = lastRingAt > 0 ? now - lastRingAt : -1;
  const inWindow = lastRingAt > 0 && elapsedMs < ringWindowSec * 1000;

  if (!enforceRingWindow || TRUSTED_AUTO_SOURCES.has(source)) {
    return { allowed: true, inWindow, elapsedMs };
  }
  if (inWindow) return { allowed: true, inWindow, elapsedMs };
  return {
    allowed: false,
    inWindow,
    elapsedMs,
    reason:
      lastRingAt === 0
        ? "Kein Klingelvorgang — Tür öffnen ist nur innerhalb des Ring-Fensters erlaubt."
        : `Ring-Fenster abgelaufen (${Math.round(elapsedMs / 1000)} s seit Klingeln).`,
  };
}
