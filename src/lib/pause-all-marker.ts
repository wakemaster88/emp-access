/**
 * Kennung „Alle pausieren“ am Ticket (`Ticket.extras`).
 *
 * „Alle pausieren“ am Scan-Monitor merkt sich je Ticket, dass es von dort
 * pausiert wurde (`pausedBy: "pause-all"`), den Status davor
 * (`pauseAllPrevStatus`) und den Zeitpunkt (`pauseAllAt`, ISO). Gelesen wird beides nur, solange die Regel
 * „„Alle fortsetzen“ hebt nur die eigene Pause auf“ an ist (lib/link-rules);
 * „Alle fortsetzen“ und die Einzel-Pause entfernen die Kennung wieder.
 *
 * Rein, ohne Datenbank.
 */

export const PAUSE_ALL_MARKER = "pause-all";
export const PAUSE_ALL_KEYS = ["pausedBy", "pauseAllPrevStatus", "pauseAllAt"] as const;

export type PauseAllPrevStatus = "VALID" | "REDEEMED";

function asObject(extras: unknown): Record<string, unknown> {
  return extras && typeof extras === "object" && !Array.isArray(extras)
    ? { ...(extras as Record<string, unknown>) }
    : {};
}

/**
 * Kann „Alle pausieren“ die Kennung setzen? Nur bei leeren Extras oder einem
 * Extras-Objekt; Arrays und Einzelwerte bleiben wie bisher ohne Kennung.
 */
export function pauseAllMarkable(extras: unknown): boolean {
  return extras == null || (typeof extras === "object" && !Array.isArray(extras));
}

/** Die Schlüssel der Kennung für einen Zeitpunkt. */
export function pauseAllMarker(previousStatus: PauseAllPrevStatus, at: Date): Record<string, string> {
  return { pausedBy: PAUSE_ALL_MARKER, pauseAllPrevStatus: previousStatus, pauseAllAt: at.toISOString() };
}

/** Extras mit Kennung; die übrigen Schlüssel bleiben. */
export function withPauseAllMarker(extras: unknown, previousStatus: PauseAllPrevStatus, at: Date): Record<string, unknown> {
  return { ...asObject(extras), ...pauseAllMarker(previousStatus, at) };
}

/** Entfernt die Kennung aus einem Extras-Objekt (verändert es). */
export function stripPauseAllMarker(extras: Record<string, unknown>): Record<string, unknown> {
  for (const k of PAUSE_ALL_KEYS) delete extras[k];
  return extras;
}

function timeMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Status, auf den „Alle fortsetzen“ ein pausiertes Ticket zurückstellt, wenn
 * die Regel an ist. `null` heißt: nicht von „Alle pausieren“ oder seitdem
 * anders pausiert – bleibt pausiert.
 *
 * - `paymentPause` (offene Zahlung) zählt immer: der Abgleich entfernt den
 *   Vermerk, sobald das Abo gültig ist, behält aber `since` der ersten Pause.
 * - `pausedAt` (Einzel-Pause, Abgleich) zählt nur, wenn es nach „Alle
 *   pausieren“ (`pauseAllAt`) gesetzt wurde. Ein älteres `pausedAt` stammt
 *   aus einer Pause, die vorher schon aufgehoben war (das Ticket war beim
 *   Pausieren gültig). Ohne lesbare Zeitpunkte zählt es.
 */
export function pauseAllResumeStatus(extras: unknown): PauseAllPrevStatus | null {
  const ext = asObject(extras);
  if (ext.pausedBy !== PAUSE_ALL_MARKER) return null;
  if (ext.paymentPause != null) return null;
  if (ext.pausedAt != null) {
    const markerMs = timeMs(ext.pauseAllAt);
    const pausedMs = timeMs(ext.pausedAt);
    if (markerMs == null || pausedMs == null || pausedMs > markerMs) return null;
  }
  return ext.pauseAllPrevStatus === "REDEEMED" ? "REDEEMED" : "VALID";
}

/** IDs je Zielstatus für „Alle fortsetzen“ mit eingeschalteter Regel. */
export function groupPauseAllResume(
  tickets: ReadonlyArray<{ id: number; extras: unknown }>,
): Record<PauseAllPrevStatus, number[]> {
  const out: Record<PauseAllPrevStatus, number[]> = { VALID: [], REDEEMED: [] };
  for (const t of tickets) {
    const target = pauseAllResumeStatus(t.extras);
    if (target) out[target].push(t.id);
  }
  return out;
}
