/**
 * Zeitmessung fuer die Aufrufe des Bildmodells. Ollama nennt in jeder Antwort
 * (/api/chat ohne Stream), wie lange das Bereitstellen des Modells, das Lesen
 * von Bild und Prompt und das Schreiben der Antwort gedauert haben, dazu die
 * Zahl der Token. Daraus wird je Bewertung des Waechters eine Log-Zeile, z. B.
 *
 *   Wächter: Eingang: Bildmodell Übersicht 18,4 s (laden 0,1 s · Bild+Prompt
 *   14,9 s/2310 Token · Antwort 3,2 s/96 Token, 280 Zeichen); Nahaufnahme
 *   41,0 s (…); Auslöser bis Urteil 67,8 s
 *
 * Zur Antwort steht dabei, wofuer die Antwort-Token verbraucht wurden: die
 * Laenge des Antworttexts in Zeichen, die Laenge eines Denktexts, wenn einer
 * mitkommt („Denktext 14 800 Zeichen“), und der Grund, aus dem Ollama
 * aufgehoert hat, wenn er nicht „stop“ ist („done_reason length“). Vom
 * Denktext steht nur die Laenge im Log, nie der Inhalt.
 *
 * Obergrenze der Antwort (HUB_AGENT_VISION_NUM_PREDICT, readNumPredict):
 * Standard ist keine Grenze. Mit Grenze zaehlt eine Antwort, die an ihr
 * abbricht (done_reason „length“), wie ein Fehler des Bildmodells
 * (answerCutOff): Sie ist unvollstaendig, und der Waechter behandelt den
 * Aufruf wie einen gescheiterten.
 *
 * Reine Logik, ohne Netz und ohne Uhr. Gemessen wird nur; ohne Obergrenze
 * aendert sich an den Aufrufen nichts.
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

/**
 * Was in der Antwort stand, als Laengen: Antworttext, Denktext und der Grund
 * des Endes. Der Text selbst bleibt hier draussen.
 */
export interface VisionOutput {
  /** Zeichen in message.content, wie geliefert, ohne einen Denkblock (<think>…</think>); null = Feld fehlt. */
  contentChars: number | null;
  /** Davon Leerraum (Leerzeichen, Zeilenumbrueche, Tabulatoren). */
  blankChars: number;
  /** Zeichen eines Denktexts: message.thinking und ein Denkblock im Antworttext zusammen; 0 = keiner oder nur leer. */
  thinkingChars: number;
  /** Der Denktext stand (auch) als Denkblock im Antworttext statt in message.thinking. */
  thinkingInline: boolean;
  /** done_reason: warum Ollama aufgehoert hat („stop“, „length“ …); null = Feld fehlt. */
  doneReason: string | null;
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/** Laenge eines Textes, der mehr als Leerraum enthaelt; sonst 0. */
const filledLength = (s: string): number => (s.trim() ? s.length : 0);

/**
 * Laengen aus dem Antwort-Objekt von Ollama lesen. Ein Denkblock im
 * Antworttext (alles bis zum letzten „</think>“, oder ein „<think>“ ohne
 * Ende) zaehlt als Denktext, nicht als Antworttext; ein leerer Denkblock
 * und ein leeres message.thinking zaehlen als kein Denktext. Fehlt
 * message.content oder ist es kein Text, ist contentChars null.
 */
export function readVisionOutput(body: unknown): VisionOutput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const m = (typeof b.message === "object" && b.message !== null ? b.message : {}) as Record<string, unknown>;
  const raw = typeof m.content === "string" ? m.content : null;
  let content = raw;
  let inline = 0;
  if (raw !== null) {
    const close = raw.lastIndexOf(THINK_CLOSE);
    const start = raw.trimStart();
    if (close >= 0) {
      const open = raw.indexOf(THINK_OPEN);
      inline = filledLength(raw.slice(open >= 0 && open < close ? open + THINK_OPEN.length : 0, close));
      content = raw.slice(close + THINK_CLOSE.length);
    } else if (start.startsWith(THINK_OPEN)) {
      // Abgebrochen, bevor der Denkblock zu Ende war: alles ist Denktext.
      inline = filledLength(start.slice(THINK_OPEN.length));
      content = "";
    }
  }
  const field = typeof m.thinking === "string" ? filledLength(m.thinking) : 0;
  const reason = typeof b.done_reason === "string" ? b.done_reason.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return {
    contentChars: content === null ? null : content.length,
    blankChars: content === null ? 0 : content.length - content.replace(/\s/g, "").length,
    thinkingChars: field + inline,
    thinkingInline: inline > 0,
    doneReason: reason || null,
  };
}

const NS_PER_MS = 1e6;

/** Nanosekunden als Sekunden mit einer Nachkommastelle: 14_900_000_000 → „14,9 s“. */
export function secondsText(ns: number): string {
  return `${(ns / 1e9).toFixed(1).replace(".", ",")} s`;
}

/** Ganze Zahl mit Leerzeichen in Dreiergruppen ab fuenf Stellen: 4100 → „4100“, 14800 → „14 800“. */
export function groupDigits(n: number): string {
  const s = String(Math.round(n));
  return s.replace(/^-/, "").length < 5 ? s : s.replace(/\B(?=(\d{3})+$)/g, " ");
}

/** Ab diesem Anteil Leerraum am Antworttext steht er dabei („davon 3900 Leerraum“) … */
export const BLANK_SHARE = 0.5;
/** … sofern der Antworttext mindestens so lang ist. */
export const BLANK_MIN_CHARS = 100;

/**
 * Zusaetze zur Antwort: Antworttext in Zeichen (mit Leerraum, wenn er die
 * Haelfte ausmacht), Denktext in Zeichen, done_reason, wenn er nicht „stop“ ist.
 */
export function outputParts(o: VisionOutput): string[] {
  const parts: string[] = [];
  if (o.contentChars !== null) {
    const blank = o.contentChars >= BLANK_MIN_CHARS && o.blankChars >= BLANK_SHARE * o.contentChars;
    parts.push(`${groupDigits(o.contentChars)} Zeichen${blank ? `, davon ${groupDigits(o.blankChars)} Leerraum` : ""}`);
  }
  if (o.thinkingChars > 0) parts.push(`Denktext ${groupDigits(o.thinkingChars)} Zeichen${o.thinkingInline ? " (im Antworttext)" : ""}`);
  if (o.doneReason !== null && o.doneReason !== "stop") parts.push(`done_reason ${o.doneReason}`);
  return parts;
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
 * dabei, sobald es zu 90 % gefuellt ist. Mit `output` stehen bei der Antwort
 * Antworttext, Denktext und done_reason (outputParts).
 */
export function timingText(t: VisionTiming, numCtx = 0, output: VisionOutput | null = null): string {
  const wallNs = t.wallMs * NS_PER_MS;
  const head = secondsText(t.totalNs ?? wallNs);
  const parts: string[] = [];
  if (t.loadNs !== null) parts.push(`laden ${secondsText(t.loadNs)}`);
  const prompt = phaseText("Bild+Prompt", t.promptNs, t.promptTokens, numCtx);
  if (prompt) parts.push(prompt);
  const answer = phaseText("Antwort", t.evalNs, t.evalTokens, 0);
  const extra = output ? outputParts(output) : [];
  if (answer || extra.length) parts.push(answer ? [answer, ...extra].join(", ") : `Antwort ${extra.join(", ")}`);
  const known = [t.loadNs, t.promptNs, t.evalNs].filter((v): v is number => v !== null);
  if (t.totalNs !== null && known.length) {
    const rest = t.totalNs - known.reduce((a, b) => a + b, 0);
    if (rest >= REST_MIN_NS) parts.push(`Rest ${secondsText(rest)}`);
  }
  if (t.totalNs !== null && wallNs - t.totalNs >= HUB_EXTRA_MIN_NS) parts.push(`im Hub ${secondsText(wallNs)}`);
  return `${head} (${parts.length ? parts.join(" · ") : "ohne Zeitangaben von Ollama"})`;
}

/* ------------------------------------------------------------ Obergrenze der Antwort */

/**
 * HUB_AGENT_VISION_NUM_PREDICT lesen: hoechstens so viele Antwort-Token je
 * Bewertung des Waechters (Ollama `num_predict`). Nur eine ganze Zahl ab 1
 * gilt; fehlt der Wert oder ist er ungueltig (0, negativ, Bruch, Text,
 * zu gross), gibt es keine Grenze (null).
 */
export function readNumPredict(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Text fuer die Log-Zeile zur Obergrenze beim ersten Bereitstellen des
 * Bildmodells; null = nicht gesetzt (Standard, keine Zeile).
 */
export function numPredictText(raw: string | undefined, limit: number | null): string | null {
  if (limit !== null) return `höchstens ${limit} Antwort-Token je Bewertung des Wächters (HUB_AGENT_VISION_NUM_PREDICT)`;
  const s = (raw ?? "").trim();
  if (!s) return null;
  return `HUB_AGENT_VISION_NUM_PREDICT „${s.slice(0, 20)}“ ist keine ganze Zahl ab 1 – keine Grenze`;
}

/**
 * Ist die Antwort an der Obergrenze abgebrochen? Nur mit Grenze und
 * done_reason „length“: Dann ist sie unvollstaendig und zaehlt wie ein
 * Fehler des Bildmodells. Ohne Grenze bleibt es bei der Auswertung wie
 * bisher.
 */
export function answerCutOff(output: VisionOutput, limit: number | null): boolean {
  return limit !== null && output.doneReason === "length";
}

/** Fehlertext zu einer Antwort, die an der Obergrenze abgebrochen ist. */
export function cutOffText(limit: number): string {
  return `Antwort an der Grenze von ${limit} Token abgebrochen (HUB_AGENT_VISION_NUM_PREDICT)`;
}

/* ------------------------------------------------------------ Zeile je Bewertung */

/** Ein Aufruf des Bildmodells innerhalb einer Bewertung. */
export interface VisionCall {
  /** Wozu: „Übersicht“ (erstes Bild) oder „Nahaufnahme“ (Person). */
  label: string;
  /** Dauer aus Sicht des Hubs (ms). */
  wallMs: number;
  /** Zeitangaben der Antwort; null = keine Antwort, der Aufruf ist gescheitert. */
  timing: VisionTiming | null;
  /** Laengen von Antwort- und Denktext und done_reason; fehlt, wenn keine Antwort kam. */
  output?: VisionOutput | null;
  /** Die Antwort ist an der Obergrenze abgebrochen (answerCutOff) und zaehlt als gescheitert. */
  cut?: boolean;
  /** Ende des Aufrufs (ms seit 1970). */
  endedAt: number;
}

/** Hat der Aufruf eine verwertbare Antwort gebracht? */
const answered = (c: VisionCall): boolean => c.timing !== null && !c.cut;

/**
 * Log-Zeile zu einer Bewertung: alle Aufrufe des Bildmodells in ihrer
 * Reihenfolge und die Zeit vom Ausloeser bis zur letzten Antwort. null, wenn
 * die Bewertung das Bildmodell nicht aufgerufen hat.
 */
export function timingLine(camera: string, calls: VisionCall[], triggerAt: number, numCtx = 0): string | null {
  if (!calls.length) return null;
  const parts = calls.map(
    (c) =>
      `${c.label} ${
        c.timing
          ? `${c.cut ? "an der Grenze abgebrochen " : ""}${timingText(c.timing, numCtx, c.output ?? null)}`
          : `gescheitert nach ${secondsText(c.wallMs * NS_PER_MS)}`
      }`
  );
  const last = calls[calls.length - 1];
  const waited = last.endedAt - triggerAt;
  if (Number.isFinite(waited) && waited >= 0) parts.push(`Auslöser bis ${answered(last) ? "Urteil" : "Abbruch"} ${secondsText(waited * NS_PER_MS)}`);
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
 *    (dazu sentinel_model_cut, wenn die Antwort an der Obergrenze abbrach)
 *  - sentinel_model_slow: 30 s oder laenger
 *  - sentinel_model_cold: das Modell wurde erst geladen (1 s oder laenger)
 *  - sentinel_model_ctx: Bild und Prompt fuellen das Kontextfenster zu 90 % oder mehr
 * und je Bewertung mit Antwort: sentinel_verdict, dazu sentinel_verdict_late,
 * wenn die letzte Antwort spaeter als 30 s nach dem Ausloeser kam.
 */
export function inspectionCounters(calls: VisionCall[], triggerAt: number, numCtx: number): string[] {
  const out: string[] = [];
  for (const c of calls) {
    if (!c.timing || c.cut) {
      out.push("sentinel_model_error");
      if (c.cut) out.push("sentinel_model_cut");
      continue;
    }
    out.push("sentinel_model_call");
    if (c.wallMs >= SLOW_CALL_MS) out.push("sentinel_model_slow");
    if ((c.timing.loadNs ?? 0) >= COLD_LOAD_NS) out.push("sentinel_model_cold");
    if (numCtx > 0 && (c.timing.promptTokens ?? 0) >= CTX_NEAR * numCtx) out.push("sentinel_model_ctx");
  }
  const last = calls[calls.length - 1];
  if (last && answered(last)) {
    out.push("sentinel_verdict");
    if (last.endedAt - triggerAt > LATE_VERDICT_MS) out.push("sentinel_verdict_late");
  }
  return out;
}
