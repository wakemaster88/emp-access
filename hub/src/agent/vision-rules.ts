/**
 * Bildmodell des Waechters: was geschieht, wenn es nicht bereit ist oder
 * nicht antwortet. Reine Logik, ohne Netz und ohne Uhr.
 *
 *  - Befund beim Zustands-Waechter (visionFinding): „Bildmodell nicht bereit“
 *    bzw. „Bildmodell antwortet nicht (N Fehler in Folge)“.
 *  - Wiederanlauf (visionUpkeepStep): Ist das Bildmodell nicht bereit, wird es
 *    hoechstens alle 5 Minuten neu bereitgestellt; im Log steht eine Zeile je
 *    Wechsel.
 *  - Bewertung ohne Bildmodell (onVisionError): Scheitert der Aufruf, geht
 *    bei einer Person im Bild oder im Nachtfenster ein Alarm mit dem Vermerk
 *    „ungeprüft“ hinaus.
 */
import type { Finding } from "./findings.js";
import { inQuietHours } from "./quiet.js";

/* ------------------------------------------------------------ Befund */

/** So lange darf das Bildmodell nicht bereit sein, ohne dass es ein Befund ist (Start, kurzer Wechsel). */
export const VISION_GRACE_MS = 60_000;
/**
 * Ab so vielen Fehlern in Folge ist „antwortet nicht“ ein Befund. Schon der
 * erste zaehlt: Eine Bewertung, die das Bildmodell nicht beantwortet hat,
 * bleibt so nie ohne Meldung.
 */
export const VISION_FAIL_STREAK = 1;

export interface VisionHealth {
  /** Das Bildmodell ist eingeschaltet (HUB_AGENT_VISION ist nicht "0"). */
  enabled: boolean;
  /** Der Waechter mit Bildern ist eingeschaltet. */
  sentinel: boolean;
  ready: boolean;
  /** Seit so vielen Millisekunden ist es bereit bzw. nicht bereit. */
  sinceMs: number;
  /** Es wird gerade bereitgestellt (Modell wird geladen). */
  installing: boolean;
  /** Woran das Bereitstellen zuletzt gescheitert ist. */
  error: string | null;
  /** Gescheiterte Aufrufe in Folge; der erste gelungene setzt auf 0. */
  failStreak: number;
  /** Fehlertext des letzten gescheiterten Aufrufs. */
  lastError: string | null;
}

/**
 * Befund des Zustands-Waechters zum Bildmodell; null, wenn es keinen gibt.
 * Solange der Waechter mit Bildern eingeschaltet ist, ist es ein Alarm: Er
 * wird bei der naechsten Pruefung gemeldet, auch in der Ruhezeit, weil der
 * Waechter ohne Bildmodell keine Kamera-Ereignisse bewertet. Ist der Waechter
 * mit Bildern aus, ist es eine Warnung. Der Schluessel ist in beiden Faellen
 * derselbe: Wechselt der Grund, gibt es keine zweite Meldung.
 */
export function visionFinding(h: VisionHealth): Finding | null {
  if (!h.enabled) return null;
  const severity = h.sentinel ? "alert" : "warn";
  if (!h.ready) {
    if (h.sinceMs < VISION_GRACE_MS) return null;
    const why = h.installing ? "Das Modell wird gerade geladen" : h.error || "Grund unbekannt";
    return {
      key: "vision",
      severity,
      title: "Bildmodell nicht bereit",
      detail: `${why}.${h.sentinel ? " Der Wächter mit Bildern bewertet so lange keine Kamera-Ereignisse." : ""}`,
    };
  }
  if (h.failStreak >= VISION_FAIL_STREAK) {
    return {
      key: "vision",
      severity,
      title: `Bildmodell antwortet nicht (${h.failStreak} Fehler in Folge)`,
      detail:
        `${h.lastError || "Grund unbekannt"}.` +
        (h.sentinel ? " Bei einer Person im Bild und im Nachtfenster geht der Alarm ungeprüft hinaus." : ""),
    };
  }
  return null;
}

/**
 * Kurztext zu einem gescheiterten Aufruf des Bildmodells, fuer den Befund:
 * Zeitueberschreitung und „Ollama nicht erreichbar“ in Worten, sonst die
 * erste Zeile der Fehlermeldung.
 */
export function visionErrorText(err: unknown): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as { name?: unknown; message?: unknown; cause?: unknown };
  if (e.name === "TimeoutError" || e.name === "AbortError") return "Zeitüberschreitung";
  const message = typeof e.message === "string" && e.message.trim() ? e.message.trim().split("\n")[0] : String(err);
  if (message === "fetch failed") {
    const cause = (typeof e.cause === "object" && e.cause !== null ? e.cause : {}) as { code?: unknown };
    return `Ollama nicht erreichbar${typeof cause.code === "string" && cause.code ? ` (${cause.code})` : ""}`;
  }
  return message;
}

/* ------------------------------------------------------------ Wiederanlauf */

/** Abstand zwischen zwei Versuchen, das Bildmodell neu bereitzustellen. */
export const VISION_RETRY_MS = 5 * 60_000;

export interface VisionRetry {
  ready: boolean;
  /** Ein Versuch laeuft gerade (Modell wird geladen). */
  busy: boolean;
  /** Beginn des letzten Versuchs; null = noch keiner. */
  lastTryAt: number | null;
  now: number;
}

/** Soll der Takt des Waechters das Bildmodell jetzt neu bereitstellen? Hoechstens alle 5 Minuten, nie zwei Versuche zugleich. */
export function visionRetryDue(r: VisionRetry): boolean {
  if (r.ready || r.busy) return false;
  return r.lastTryAt === null || r.now - r.lastTryAt >= VISION_RETRY_MS;
}

/** Stand des Bildmodells, wie ihn der Takt des Waechters sieht. */
export interface VisionNow {
  ready: boolean;
  /** Seit so vielen Millisekunden ist es bereit bzw. nicht bereit. */
  sinceMs: number;
  /** Es wird gerade bereitgestellt (Modell wird geladen). */
  busy: boolean;
  /** Woran das Bereitstellen zuletzt gescheitert ist. */
  error: string | null;
}

/**
 * Log-Zeile, wenn das Bildmodell fuer den Waechter ausfaellt oder wieder da
 * ist; null, wenn sich nichts geaendert hat. `wasDown` ist der zuletzt
 * geloggte Stand. Als ausgefallen gilt es erst nach VISION_GRACE_MS, damit
 * der Start des Hubs keine Zeile schreibt.
 */
export function visionChangeLine(wasDown: boolean, h: VisionNow): { down: boolean; line: string | null } {
  const down = !h.ready && h.sinceMs >= VISION_GRACE_MS;
  if (h.ready && wasDown) return { down: false, line: "Wächter: Bildmodell wieder bereit, Kamera-Ereignisse werden wieder bewertet" };
  if (down && !wasDown) {
    const why = h.busy ? "wird gerade geladen" : h.error || "Grund unbekannt";
    return {
      down: true,
      line: `Wächter: Bildmodell nicht bereit (${why}), Kamera-Ereignisse werden so lange nicht bewertet; Wiederanlauf alle ${VISION_RETRY_MS / 60_000} Minuten`,
    };
  }
  return { down: wasDown && !h.ready, line: null };
}

/** Was der Takt des Waechters zum Bildmodell behaelt. */
export interface VisionUpkeep {
  /** Zuletzt geloggter Stand: Das Bildmodell gilt als ausgefallen. */
  down: boolean;
  /** Beginn des letzten Wiederanlaufs aus dem Takt; null = noch keiner. */
  lastTryAt: number | null;
}

export function newVisionUpkeep(): VisionUpkeep {
  return { down: false, lastTryAt: null };
}

/**
 * Ein Takt des Waechters zum Bildmodell: die Log-Zeile bei einem Wechsel
 * (nur mit `sentinel`, also wenn der Waechter mit Bildern eingeschaltet ist)
 * und ob das Bildmodell jetzt neu bereitgestellt werden soll. Beides wird in
 * `st` vermerkt: Ein Versuch, den diese Funktion verlangt, gilt als begonnen.
 */
export function visionUpkeepStep(st: VisionUpkeep, h: VisionNow, now: number, sentinel: boolean): { line: string | null; retry: boolean } {
  let line: string | null = null;
  if (sentinel) {
    const change = visionChangeLine(st.down, h);
    st.down = change.down;
    line = change.line;
  }
  const retry = visionRetryDue({ ready: h.ready, busy: h.busy, lastTryAt: st.lastTryAt, now });
  if (retry) st.lastTryAt = now;
  return { line, retry };
}

/* ------------------------------------------------------------ Bewertung ohne Bildmodell */

export interface VisionErrorContext {
  /** Der Ausloeser ist ein Personen-Ereignis der Kamera. */
  isPerson: boolean;
  /** Personen, die der Tracker auf dem Standbild sieht; null = nicht gefragt oder Tracker nicht erreichbar. */
  trackerCount: number | null;
  /** Ortszeit-Stunde; NaN, wenn sie nicht lesbar ist. */
  hour: number;
  /** Nachtfenster des Waechters, z. B. "22-6". */
  nightWindow: string;
}

/**
 * Der Aufruf des Bildmodells zum Uebersichtsbild ist gescheitert: Alarm ohne
 * Bewertung oder nur der Befund beim Zustands-Waechter?
 *  - "alarm": Personen-Ausloeser, und der Tracker sieht auf dem Standbild
 *    mindestens eine Person; oder das Ereignis faellt ins Nachtfenster. Der
 *    Alarm geht mit dem Vermerk „ungeprüft“ und dem Standbild hinaus.
 *  - "befund": sonst. Dann bleibt es beim Befund (visionFinding).
 * Ist die Stunde nicht lesbar, gilt kein Nachtfenster.
 */
export function onVisionError(ctx: VisionErrorContext): "alarm" | "befund" {
  if (ctx.isPerson && ctx.trackerCount !== null && ctx.trackerCount >= 1) return "alarm";
  return inQuietHours(ctx.nightWindow, ctx.hour) ? "alarm" : "befund";
}

/** Vermerk am Alarm, den kein Bildmodell bewertet hat. */
export const UNVERIFIED_NOTE = "ungeprüft, Bildmodell nicht erreichbar";

/**
 * Text des ungeprueften Alarms: was die Kamera gemeldet hat, was der Tracker
 * auf dem Standbild sieht (nur bei Personen, und nur wenn er geantwortet
 * hat), und der Vermerk.
 */
export function unverifiedText(isPerson: boolean, trackerCount: number | null): string {
  let seen = "";
  if (isPerson && trackerCount !== null) {
    seen = trackerCount >= 1 ? ` (Tracker sieht ${trackerCount} ${trackerCount === 1 ? "Person" : "Personen"})` : " (Tracker sieht niemanden)";
  }
  return `${isPerson ? "Person" : "Fahrzeug"} von der Kamera gemeldet${seen} – ${UNVERIFIED_NOTE}`;
}
