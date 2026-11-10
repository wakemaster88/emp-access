/**
 * Pure Entscheidungslogik fürs Tür-Öffnen — getrennt von der Route,
 * damit sie ohne HTTP-Kontext testbar ist.
 */

/**
 * Quellen, die das Ring-Fenster umgehen dürfen (eigene Schutzlogik im
 * Sidecar: Whitelist bzw. Zone + Cooldown). Gilt nur für Aufrufe, die sich
 * mit dem internen Token ausgewiesen haben — `source` allein kommt aus dem
 * Request-Body und ist frei wählbar.
 */
const TRUSTED_AUTO_SOURCES = new Set(["alpr", "vehicle-gate"]);

/**
 * Bestimmt die Quelle, mit der ein Tür-Öffnen bewertet und protokolliert
 * wird. Nur intern authentifizierte Aufrufe dürfen eine Quelle angeben;
 * alles andere ist ein normaler UI-Aufruf (`"ui"`).
 */
export function resolveDoorSource(
  requested: string | undefined,
  internal: boolean,
): string {
  if (!internal) return "ui";
  return requested || "ui";
}

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
  /** Aufruf hat das interne Token vorgelegt (Sidecar). */
  internal: boolean;
  lastRingAt: number; // 0 = nie
  now: number;
  ringWindowSec: number;
}): DoorOpenDecision {
  const { enforceRingWindow, source, internal, lastRingAt, now, ringWindowSec } = opts;
  const elapsedMs = lastRingAt > 0 ? now - lastRingAt : -1;
  const inWindow = lastRingAt > 0 && elapsedMs < ringWindowSec * 1000;

  if (!enforceRingWindow || (internal && TRUSTED_AUTO_SOURCES.has(source))) {
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
