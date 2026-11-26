/**
 * Regeln des gemeinsamen Tracker-Aufrufs (ohne I/O, testbar): wann der
 * YOLO-Tracker als aus gilt, welche Antwort einen Ausfall bedeutet und wie
 * Ausschnitt und Auflösung an /classify gehen. Der Aufruf selbst steht in
 * tracker-client.ts.
 */

/**
 * Zeitlimit jedes Aufrufs ohne Angabe. 6 s ist das längste der früheren
 * Limits (5 s für Fahrzeuge und Live-Personen, 6 s für Personen): Was bisher
 * rechtzeitig ankam, kommt weiter rechtzeitig an. Der erste Aufruf nach dem
 * Start des Trackers braucht rund 4 s (Modell laden).
 */
export const DEFAULT_TRACKER_TIMEOUT_MS = 6_000;

/** HUB_VISION_TIMEOUT_MS in ms: eine positive Zahl, sonst DEFAULT_TRACKER_TIMEOUT_MS. */
export function trackerTimeoutMs(raw: string | undefined): number {
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : DEFAULT_TRACKER_TIMEOUT_MS;
}

/** Nach so vielen Fehlern in Folge gilt der Tracker als aus … */
export const BREAKER_FAILS = 2;
/** … für so lange; danach geht der nächste Aufruf wieder hinaus. */
export const BREAKER_OFF_MS = 30_000;

export interface BreakerState {
  /** Fehler in Folge (0 nach jedem Erfolg). */
  fails: number;
  /** Bis wann Aufrufer sofort kein Ergebnis bekommen (0 = nicht gesperrt). */
  offUntil: number;
  /** Gilt als aus – bis zum nächsten Erfolg. */
  down: boolean;
}

export function newBreaker(): BreakerState {
  return { fails: 0, offUntil: 0, down: false };
}

/** "ask": darf ein Aufruf hinaus? "ok"/"fail": Ausgang eines Aufrufs. */
export type BreakerEvent = "ask" | "ok" | "fail";

export interface BreakerConfig {
  fails: number;
  offMs: number;
}

export interface BreakerStep {
  state: BreakerState;
  /** Nur bei "ask": Der Aufruf darf hinaus. */
  allow: boolean;
  /** Zustandswechsel für die eine Log-Zeile: "down" = gilt ab jetzt als aus, "up" = antwortet wieder. */
  change: "down" | "up" | null;
}

/**
 * Ausfallschalter des Trackers. Nach `fails` Fehlern in Folge gilt er
 * `offMs` lang als aus: Aufrufer bekommen sofort kein Ergebnis, statt einzeln
 * auf ihr Zeitlimit zu warten. Danach geht wieder ein Aufruf hinaus;
 * scheitert er, bleibt der Tracker weitere `offMs` aus (ohne neuen
 * Zustandswechsel), gelingt er, ist er wieder an. Ein Erfolg setzt die
 * Fehlerzahl immer zurück.
 */
export function breakerStep(
  state: BreakerState,
  event: BreakerEvent,
  now: number,
  cfg: BreakerConfig = { fails: BREAKER_FAILS, offMs: BREAKER_OFF_MS },
): BreakerStep {
  if (event === "ask") {
    return { state, allow: !(state.down && now < state.offUntil), change: null };
  }
  if (event === "ok") {
    return { state: newBreaker(), allow: true, change: state.down ? "up" : null };
  }
  const fails = state.fails + 1;
  if (fails < cfg.fails) return { state: { ...state, fails }, allow: true, change: null };
  return { state: { fails, offUntil: now + cfg.offMs, down: true }, allow: true, change: state.down ? null : "down" };
}

/**
 * Zählt eine Antwort als Ausfall des Trackers? Keine Antwort (Netz, Zeitlimit;
 * `status` null), ein Serverfehler, eine abgelehnte PIN (401/403) oder eine
 * fehlende Route (404, Tracker ohne /classify). Ein anderer Fehler der
 * Anfrage (etwa 400 „invalid jpeg“) heißt: Der Tracker antwortet, nur dieses
 * Bild taugt nicht.
 */
export function trackerDown(status: number | null): boolean {
  if (status === null) return true;
  if (status >= 500) return true;
  return status === 401 || status === 403 || status === 404;
}

/** Normiertes Rechteck (0..1). */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Höchste Auflösung, die der Tracker für einen Ausschnitt annimmt. */
export const MAX_IMGSZ = 1280;

/**
 * Query für /classify. Ohne Ausschnitt und Auflösung leer (der Tracker
 * rechnet wie bisher). Der Ausschnitt wird auf das Bild begrenzt; ist er
 * leer oder unbrauchbar, entfällt er. `imgsz` wird auf ein Vielfaches von 32
 * zwischen 32 und MAX_IMGSZ gerundet (so verlangt es YOLO).
 */
export function classifyQuery(opts: { roi?: NormRect | null; imgsz?: number | null }): string {
  const q = new URLSearchParams();
  const r = opts.roi ? clampRect(opts.roi) : null;
  if (r) q.set("roi", [r.x, r.y, r.w, r.h].map((v) => v.toFixed(4)).join(","));
  if (opts.imgsz != null && Number.isFinite(opts.imgsz) && opts.imgsz > 0) {
    const sz = Math.min(MAX_IMGSZ, Math.max(32, Math.round(opts.imgsz / 32) * 32));
    q.set("imgsz", String(sz));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function clampRect(r: NormRect): NormRect | null {
  if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) return null;
  const x0 = Math.min(1, Math.max(0, r.x));
  const y0 = Math.min(1, Math.max(0, r.y));
  const x1 = Math.min(1, Math.max(0, r.x + r.w));
  const y1 = Math.min(1, Math.max(0, r.y + r.h));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
