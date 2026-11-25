/**
 * Zeitmessung fuer die Aufrufe des Bildmodells. Ollama nennt in jeder Antwort
 * (/api/chat ohne Stream), wie lange das Bereitstellen des Modells, das Lesen
 * von Bild und Prompt und das Schreiben der Antwort gedauert haben, dazu die
 * Zahl der Token. Daraus wird je Bewertung des Waechters eine Log-Zeile, z. B.
 *
 *   Wächter: Eingang: Bildmodell Übersicht 18,4 s (laden 0,1 s · Bild+Prompt
 *   14,9 s/2310 Token · Antwort 3,2 s/96 Token); Nahaufnahme 41,0 s (…);
 *   Auslöser bis Urteil 67,8 s
 *
 * Reine Logik, ohne Netz und ohne Uhr. Gemessen wird nur; an den Aufrufen
 * aendert sich nichts.
 */

/** Zeitangaben einer Antwort des Bildmodells. Dauern in Nanosekunden, wie Ollama sie nennt; null = Feld fehlt. */
export interface VisionTiming {
  /** Dauer des Aufrufs, wie der Hub sie misst (ms). */
  wallMs: number;
  /** total_duration: die ganze Bearbeitung in Ollama. */
  totalNs: number | null;
  /** load_duration: Modell bereitstellen (in den Speicher laden). */
  loadNs: number | null;
  /** prompt_eval_count: Token aus Bild und Prompt. */
  promptTokens: number | null;
  /** prompt_eval_duration: Bild und Prompt lesen. */
  promptNs: number | null;
  /** eval_count: Token der Antwort. */
  evalTokens: number | null;
  /** eval_duration: Antwort schreiben. */
  evalNs: number | null;
}

const duration = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/**
 * Zeitfelder aus dem Antwort-Objekt von Ollama lesen. Ein Feld, das fehlt
 * oder keine Zahl ab 0 ist, wird null; ein Antwort-Objekt ohne Zeitfelder
 * ergibt nur die Dauer, die der Hub selbst gemessen hat.
 */
export function readVisionTiming(body: unknown, wallMs: number): VisionTiming {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return {
    wallMs: Number.isFinite(wallMs) && wallMs > 0 ? wallMs : 0,
    totalNs: duration(b.total_duration),
    loadNs: duration(b.load_duration),
    promptTokens: count(b.prompt_eval_count),
    promptNs: duration(b.prompt_eval_duration),
    evalTokens: count(b.eval_count),
    evalNs: duration(b.eval_duration),
  };
}

const NS_PER_MS = 1e6;

/** Nanosekunden als Sekunden mit einer Nachkommastelle: 14_900_000_000 → „14,9 s“. */
export function secondsText(ns: number): string {
  return `${(ns / 1e9).toFixed(1).replace(".", ",")} s`;
}

/** Ab diesem Anteil des Kontextfensters steht die Groesse des Fensters dabei („7900 von 8192 Token“). */
export const CTX_NEAR = 0.9;
/** Ab so viel Zeit, die keiner der drei Abschnitte erklaert, steht sie als „Rest“ dabei. */
const REST_MIN_NS = 0.5e9;
/** Ab so viel Unterschied zwischen der Messung des Hubs und der von Ollama stehen beide da. */
const HUB_EXTRA_MIN_NS = 1e9;

/** Ein Abschnitt: Dauer und Token, je nachdem, was Ollama genannt hat; null, wenn beides fehlt. */
function phaseText(label: string, ns: number | null, tokens: number | null, numCtx: number): string | null {
  const near = tokens !== null && numCtx > 0 && tokens >= CTX_NEAR * numCtx;
  const tok = tokens === null ? null : `${tokens}${near ? ` von ${numCtx}` : ""} Token`;
  if (ns !== null && tok !== null) return `${label} ${secondsText(ns)}/${tok}`;
  if (ns !== null) return `${label} ${secondsText(ns)}`;
  if (tok !== null) return `${label} ${tok}`;
  return null;
}

/**
 * Text zu einem Aufruf: vorn die ganze Dauer (von Ollama; fehlt sie, die
 * Messung des Hubs), in Klammern die Abschnitte. „Rest“ ist Zeit, die
 * Ollama keinem Abschnitt zuordnet (zum Beispiel Warten auf einen laufenden
 * Aufruf). Mit `numCtx` steht bei Bild+Prompt die Groesse des Kontextfensters
 * dabei, sobald es zu 90 % gefuellt ist.
 */
export function timingText(t: VisionTiming, numCtx = 0): string {
  const wallNs = t.wallMs * NS_PER_MS;
  const head = secondsText(t.totalNs ?? wallNs);
  const parts: string[] = [];
  if (t.loadNs !== null) parts.push(`laden ${secondsText(t.loadNs)}`);
  const prompt = phaseText("Bild+Prompt", t.promptNs, t.promptTokens, numCtx);
  if (prompt) parts.push(prompt);
  const answer = phaseText("Antwort", t.evalNs, t.evalTokens, 0);
  if (answer) parts.push(answer);
  const known = [t.loadNs, t.promptNs, t.evalNs].filter((v): v is number => v !== null);
  if (t.totalNs !== null && known.length) {
    const rest = t.totalNs - known.reduce((a, b) => a + b, 0);
    if (rest >= REST_MIN_NS) parts.push(`Rest ${secondsText(rest)}`);
  }
  if (t.totalNs !== null && wallNs - t.totalNs >= HUB_EXTRA_MIN_NS) parts.push(`im Hub ${secondsText(wallNs)}`);
  return `${head} (${parts.length ? parts.join(" · ") : "ohne Zeitangaben von Ollama"})`;
}

/** Ein Aufruf des Bildmodells innerhalb einer Bewertung. */
export interface VisionCall {
  /** Wozu: „Übersicht“ (erstes Bild) oder „Nahaufnahme“ (Person). */
  label: string;
  /** Dauer aus Sicht des Hubs (ms). */
  wallMs: number;
  /** Zeitangaben der Antwort; null = der Aufruf ist gescheitert. */
  timing: VisionTiming | null;
  /** Ende des Aufrufs (ms seit 1970). */
  endedAt: number;
}

/**
 * Log-Zeile zu einer Bewertung: alle Aufrufe des Bildmodells in ihrer
 * Reihenfolge und die Zeit vom Ausloeser bis zur letzten Antwort. null, wenn
 * die Bewertung das Bildmodell nicht aufgerufen hat.
 */
export function timingLine(camera: string, calls: VisionCall[], triggerAt: number, numCtx = 0): string | null {
  if (!calls.length) return null;
  const parts = calls.map((c) => `${c.label} ${c.timing ? timingText(c.timing, numCtx) : `gescheitert nach ${secondsText(c.wallMs * NS_PER_MS)}`}`);
  const last = calls[calls.length - 1];
  const waited = last.endedAt - triggerAt;
  if (Number.isFinite(waited) && waited >= 0) parts.push(`Auslöser bis ${last.timing ? "Urteil" : "Abbruch"} ${secondsText(waited * NS_PER_MS)}`);
  return `Wächter: ${camera}: Bildmodell ${parts.join("; ")}`;
}

/** Ab dieser Dauer (Messung des Hubs) zaehlt ein Aufruf als langsam. */
export const SLOW_CALL_MS = 30_000;
/** Ab dieser Ladezeit musste das Modell erst in den Speicher geholt werden. */
export const COLD_LOAD_NS = 1e9;
/** Kommt die letzte Antwort spaeter nach dem Ausloeser, zaehlt die Bewertung als spaet. */
export const LATE_VERDICT_MS = 30_000;

/**
 * Zaehler zu einer Bewertung (improveCount, Art „camera“), je Aufruf:
 *  - sentinel_model_call: beantwortet; sentinel_model_error: gescheitert
 *  - sentinel_model_slow: 30 s oder laenger
 *  - sentinel_model_cold: das Modell wurde erst geladen (1 s oder laenger)
 *  - sentinel_model_ctx: Bild und Prompt fuellen das Kontextfenster zu 90 % oder mehr
 * und je Bewertung mit Antwort: sentinel_verdict, dazu sentinel_verdict_late,
 * wenn die letzte Antwort spaeter als 30 s nach dem Ausloeser kam.
 */
export function inspectionCounters(calls: VisionCall[], triggerAt: number, numCtx: number): string[] {
  const out: string[] = [];
  for (const c of calls) {
    if (!c.timing) {
      out.push("sentinel_model_error");
      continue;
    }
    out.push("sentinel_model_call");
    if (c.wallMs >= SLOW_CALL_MS) out.push("sentinel_model_slow");
    if ((c.timing.loadNs ?? 0) >= COLD_LOAD_NS) out.push("sentinel_model_cold");
    if (numCtx > 0 && (c.timing.promptTokens ?? 0) >= CTX_NEAR * numCtx) out.push("sentinel_model_ctx");
  }
  const last = calls[calls.length - 1];
  if (last?.timing) {
    out.push("sentinel_verdict");
    if (last.endedAt - triggerAt > LATE_VERDICT_MS) out.push("sentinel_verdict_late");
  }
  return out;
}
