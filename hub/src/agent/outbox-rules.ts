/**
 * Zustellung der Nachrichten des Waechters an Telegram: wann ein gescheiterter
 * Versand wiederholt wird, wann eine Nachricht ohne Bild hinausgeht, wann sie
 * als nicht zugestellt gilt und was davon im Log steht. Reine Logik, ohne Netz
 * und ohne Uhr.
 *
 * Der erste Versuch geht sofort hinaus, die weiteren nach 5 s, 20 s, 60 s und
 * dann alle 3 Minuten, hoechstens 15 Minuten lang ab dem Einreihen. Wiederholt
 * wird nur, was ein spaeterer Versuch heilen kann: Netzfehler,
 * Zeitueberschreitung, HTTP 5xx und 429 (dort mit der Wartezeit, die Telegram
 * nennt). Lehnt Telegram die Nachricht ab (andere 4xx), aendert ein weiterer
 * Versuch nichts.
 */
import type { Finding } from "./findings.js";

/** Wartezeit vor dem 2., 3., 4. und jedem weiteren Versuch (der erste geht sofort hinaus). */
export const RETRY_DELAYS_MS: readonly number[] = [5_000, 20_000, 60_000, 180_000];
/** So lange wird eine Nachricht hoechstens versucht, gerechnet ab dem Einreihen. */
export const MAX_AGE_MS = 15 * 60_000;
/** So viele Nachrichten warten je Chat hoechstens; Zusatzbilder kommen dann nicht mehr dazu. */
export const MAX_WAITING = 40;
/** Grund fuer Nachrichten, die beim Beenden des Hubs noch warten. */
export const CLOSED_REASON = "Hub wird beendet";
/** Anhang am Text eines Alarms, der beim Beenden des Hubs ohne sein Bild hinausgeht. */
export const CLOSED_PHOTO_NOTE = "\nBild nicht übertragen.";
/**
 * Grund eines Alarms, dessen Zustellung beim Beenden des Hubs noch lief
 * (dispatch.ts): Er steht vorsorglich in der gespeicherten Liste. Nach dem
 * Neustart nennt das Log ihn einmal, danach steht er mit OPEN_AT_EXIT_SEEN
 * in der Liste.
 */
export const OPEN_AT_EXIT = "Hub beendet, bevor die Zustellung feststand";
export const OPEN_AT_EXIT_SEEN = "Hub beendet, Zustellung offen";

/** Wartezeit vor dem naechsten Versuch nach `tries` gescheiterten: 5 s, 20 s, 60 s, dann 3 min. */
export function retryDelayMs(tries: number): number {
  if (!(tries >= 1)) return 0;
  return RETRY_DELAYS_MS[Math.min(Math.floor(tries), RETRY_DELAYS_MS.length) - 1];
}

/** Ein gescheiterter Sendeversuch, soweit die Warteschlange ihn kennen muss. */
export interface SendFailure {
  /** Ein spaeterer Versuch kann gelingen (Netzfehler, Zeitueberschreitung, HTTP 5xx, 429). */
  retry: boolean;
  /** Wartezeit, die Telegram bei 429 nennt (ms), sonst 0. */
  retryAfterMs: number;
  /** Kurztext fuer das Log. */
  reason: string;
}

/**
 * Fehler eines Sendeversuchs einordnen. Hat der Fehler einen HTTP-Status
 * (telegram.ts, TelegramError), hat Telegram geantwortet: 429 und 5xx werden
 * wiederholt, andere 4xx nicht. Eine Antwort ohne Fehlerstatus, die nicht zu
 * lesen war, zaehlt wie ein Netzfehler. Ohne Status kam keine Antwort an
 * (Netzfehler, Zeitueberschreitung): wiederholen.
 */
export function classifyFailure(err: unknown): SendFailure {
  const e = (typeof err === "object" && err !== null ? err : {}) as {
    status?: unknown;
    retryAfterSec?: unknown;
    message?: unknown;
    name?: unknown;
    cause?: unknown;
  };
  const message = typeof e.message === "string" && e.message.trim() ? e.message.trim().split("\n")[0] : String(err);
  if (typeof e.status === "number" && Number.isFinite(e.status)) {
    if (e.status === 429) {
      const sec = typeof e.retryAfterSec === "number" && e.retryAfterSec > 0 ? e.retryAfterSec : 0;
      return { retry: true, retryAfterMs: Math.ceil(sec * 1000), reason: message };
    }
    return { retry: !(e.status >= 400 && e.status < 500), retryAfterMs: 0, reason: message };
  }
  if (e.name === "TimeoutError" || e.name === "AbortError") return { retry: true, retryAfterMs: 0, reason: "Zeitüberschreitung" };
  const cause = (typeof e.cause === "object" && e.cause !== null ? e.cause : {}) as { code?: unknown };
  const code = typeof cause.code === "string" && cause.code ? ` (${cause.code})` : "";
  return { retry: true, retryAfterMs: 0, reason: `${message}${code}` };
}

export interface AttemptMode {
  /** Die Nachricht hat ein Bild. */
  hasPhoto: boolean;
  /** Das Bild ist schon aufgegeben (Telegram hat es abgelehnt). */
  textOnly: boolean;
  /** Der Text sagt auch ohne Bild, was los ist (Alarm): Notfalls geht er allein hinaus. */
  textFallback: boolean;
  queuedAt: number;
  now: number;
  maxAgeMs: number;
}

/**
 * Wie der naechste Versuch hinausgeht. Der Versuch, der am oder nach dem Ende
 * der Frist beginnt, ist der letzte: Eine Nachricht mit Text-Rueckfall geht
 * dann ohne Bild hinaus, weil ein kurzer Text am ehesten durchkommt.
 */
export function attemptMode(a: AttemptMode): "foto" | "text" {
  if (!a.hasPhoto || a.textOnly) return "text";
  return a.textFallback && a.now >= a.queuedAt + a.maxAgeMs ? "text" : "foto";
}

export interface FailedAttempt {
  /** Bisherige Versuche, den gerade gescheiterten mitgezaehlt. */
  tries: number;
  queuedAt: number;
  now: number;
  maxAgeMs: number;
  /** Der gescheiterte Versuch ging mit Bild hinaus. */
  withPhoto: boolean;
  textFallback: boolean;
}

export type NextStep =
  /** Derselbe Inhalt noch einmal, zum Zeitpunkt `at`. */
  | { then: "retry"; at: number }
  /** Ab jetzt ohne Bild, zum Zeitpunkt `at`. */
  | { then: "text"; at: number }
  | { then: "give_up" };

/**
 * Was nach einem gescheiterten Versuch geschieht.
 *  - Abgelehnt (4xx): Ein Bild mit Text-Rueckfall geht sofort als Text ohne
 *    Bild hinaus, alles andere ist nicht zustellbar.
 *  - Sonst der naechste Versuch nach dem Plan, bei 429 nicht vor der Wartezeit,
 *    die Telegram nennt. Liegt er hinter dem Ende der Frist, gibt es genau
 *    einen letzten Versuch an ihrem Ende (attemptMode), ausser Telegram
 *    verlangt eine Pause darueber hinaus.
 *  - Ist die Frist beim Scheitern schon vorbei (der Versuch begann vor ihrem
 *    Ende und lief darueber hinaus): Ein Bild mit Text-Rueckfall geht sofort
 *    noch einmal als Text ohne Bild hinaus, ausser Telegram verlangt eine
 *    Pause. So hat jeder Alarm einen Versuch ohne Bild, bevor er aufgegeben
 *    wird. Alles andere ist damit aufgegeben, auch dieser Versuch als Text.
 */
export function afterFailure(a: FailedAttempt, f: SendFailure): NextStep {
  if (!f.retry) return a.withPhoto && a.textFallback ? { then: "text", at: a.now } : { then: "give_up" };
  const deadline = a.queuedAt + a.maxAgeMs;
  if (a.now >= deadline) return a.withPhoto && a.textFallback && f.retryAfterMs <= 0 ? { then: "text", at: a.now } : { then: "give_up" };
  const at = a.now + Math.max(retryDelayMs(a.tries), f.retryAfterMs);
  if (at < deadline) return { then: "retry", at };
  return a.now + f.retryAfterMs > deadline ? { then: "give_up" } : { then: "retry", at: deadline };
}

/** Nimmt die Reihe eines Chats die Nachricht noch an? Nur Zusatzbilder werden bei voller Reihe abgewiesen. */
export function acceptsMessage(waiting: number, optional: boolean): boolean {
  return !optional || waiting < MAX_WAITING;
}

/**
 * Geht ein Zusatzbild eines Alarms (Uebersicht, Bildserie) ohne Ton hinaus?
 * Ein Alarm klingelt in jedem Chat einmal: mit seiner ersten Nachricht, die
 * dort ankommt. Hat der Alarm den Chat nicht erreicht (`alarmReached` =
 * false), kommt das erste Zusatzbild mit Ton, die weiteren kommen still,
 * sobald eins mit Ton angekommen ist (`imageRang`). Kam das Bild mit Ton
 * nicht an, klingelt das naechste. null = Ausgang des Alarms nicht bekannt:
 * ohne Ton. In der Reihe eines Chats steht das Zusatzbild hinter dem Alarm
 * und den Bildern davor, beim Versuch steht deren Ausgang also fest.
 */
export function imageSilent(alarmReached: boolean | null, imageRang: boolean): boolean {
  return alarmReached !== false || imageRang;
}

/** Ausgang einer Nachricht in der Warteschlange. */
export type OutResult =
  | {
      ok: true;
      tries: number;
      /** Zeit vom Einreihen bis zur Zustellung. */
      ms: number;
      /** Eine Nachricht mit Bild ging als Text ohne Bild hinaus. */
      asText: boolean;
      /** Woran das Bild zuletzt gescheitert ist (nur bei asText). */
      photoError: string | null;
    }
  | {
      ok: false;
      tries: number;
      ms: number;
      reason: string;
      /** Telegram hat die Nachricht abgelehnt: Ein spaeterer Versuch aendert nichts. */
      permanent: boolean;
    };

/** „25 s“, „4 min 25 s“. */
export function durationText(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${sec % 60} s`;
}

/** Zaehler-Endung je Ausgang: beim ersten Versuch, nach mehreren, als Text ohne Bild, nicht zugestellt. */
export function deliveryCounter(r: OutResult): "ok" | "retry" | "text" | "failed" {
  if (!r.ok) return "failed";
  if (r.asText) return "text";
  return r.tries > 1 ? "retry" : "ok";
}

/**
 * Log-Zeile zu einer Nachricht; null, wenn sie beim ersten Versuch
 * vollstaendig angekommen ist (das steht nur im Zaehler). `label` nennt die
 * Nachricht, z. B. „Wächter: Alarm Eingang“. Die Zeit in Klammern zaehlt ab
 * dem Einreihen, also samt der Wartezeit hinter anderen Nachrichten.
 */
export function deliveryLine(label: string, r: OutResult): string | null {
  const span = ` (${durationText(r.ms)})`;
  const after = r.tries > 1 ? ` nach ${r.tries} Versuchen${span}` : "";
  if (!r.ok) {
    const one = r.tries === 1 ? ` nach 1 Versuch${r.ms >= 1000 ? span : ""}` : after;
    return `${label} NICHT zugestellt${one}: ${r.reason}`;
  }
  if (r.asText) return `${label} als Text ohne Bild zugestellt${after}, Foto: ${r.photoError ?? "Frist abgelaufen"}`;
  return r.tries > 1 ? `${label} zugestellt${after}` : null;
}

/** Hoechstens eine Zeile je `everyMs`: Ist die naechste faellig? */
export function dueAgain(lastAt: number | null, now: number, everyMs: number): boolean {
  return lastAt === null || now - lastAt >= everyMs;
}

/* ------------------------------------- Alarme, die niemanden erreicht haben */

/** Ein Alarm des Waechters, der keinen Chat erreicht hat. */
export interface UndeliveredAlarm {
  camera: string;
  /** Zeitpunkt des Alarms. */
  at: number;
  /** Zeitpunkt, zu dem die Zustellung aufgegeben wurde. */
  failedAt: number;
  reason: string;
}

/** So lange steht ein nicht zugestellter Alarm unter den Befunden. */
export const UNDELIVERED_KEEP_MS = 12 * 60 * 60_000;
export const UNDELIVERED_MAX = 20;

/** Liste um einen Alarm ergaenzen; alte Eintraege fallen heraus. */
export function addUndelivered(list: UndeliveredAlarm[], alarm: UndeliveredAlarm, now: number): UndeliveredAlarm[] {
  return pruneUndelivered([...list, alarm], now);
}

export function pruneUndelivered(list: UndeliveredAlarm[], now: number): UndeliveredAlarm[] {
  return list.filter((a) => now - a.failedAt < UNDELIVERED_KEEP_MS).slice(-UNDELIVERED_MAX);
}

/** Liste fuer die Platte (.cache/agent-undelivered.json), damit der Befund einen Neustart des Hubs uebersteht. */
export function serializeUndelivered(list: UndeliveredAlarm[]): string {
  return JSON.stringify({ v: 1, alarms: list });
}

/**
 * Gespeicherte Liste lesen. Uebernommen werden nur vollstaendige Eintraege,
 * die noch unter den Befunden stehen (pruneUndelivered); ein Zeitpunkt in der
 * Zukunft zaehlt nicht. Unlesbarer Inhalt ergibt eine leere Liste.
 */
export function restoreUndelivered(json: string, now: number): UndeliveredAlarm[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const alarms = (raw as { alarms?: unknown } | null)?.alarms;
  if (!Array.isArray(alarms)) return [];
  const out: UndeliveredAlarm[] = [];
  for (const a of alarms as Array<Partial<UndeliveredAlarm> | null>) {
    if (!a || typeof a.camera !== "string" || !a.camera) continue;
    if (typeof a.at !== "number" || !Number.isFinite(a.at)) continue;
    if (typeof a.failedAt !== "number" || !Number.isFinite(a.failedAt) || a.failedAt > now) continue;
    out.push({ camera: a.camera, at: a.at, failedAt: a.failedAt, reason: typeof a.reason === "string" ? a.reason : "" });
  }
  return pruneUndelivered(
    out.sort((a, b) => a.failedAt - b.failedAt),
    now
  );
}

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

/**
 * Befund des Zustands-Waechters fuer Alarme, die keinen Chat erreicht haben;
 * null, wenn es keinen gibt. Der Schluessel haengt am juengsten Fehlschlag:
 * Kommt ein weiterer Alarm dazu, ist es ein neuer Befund und wird sofort
 * gemeldet, mit allen noch offenen Alarmen im Titel. Der Befund ist ein
 * Ereignis (`event`): Faellt er nach UNDELIVERED_KEEP_MS weg, gibt es keine
 * Entwarnung.
 */
export function undeliveredFinding(list: UndeliveredAlarm[], now: number): Finding | null {
  const open = pruneUndelivered(list, now);
  if (!open.length) return null;
  const newest = open[open.length - 1];
  const shown = open.slice(-5).map((a) => `${a.camera} ${hhmm(a.at)}`);
  return {
    key: `alarm-undelivered:${newest.failedAt}`,
    severity: "alert",
    event: true,
    title:
      (open.length === 1 ? "Wächter-Alarm nicht zugestellt: " : `${open.length} Wächter-Alarme nicht zugestellt: `) +
      (open.length > shown.length ? "… " : "") +
      shown.join(", "),
    // Ein beim Beenden offener Alarm hat kein Ergebnis bekommen und steht deshalb nicht im KI-Protokoll.
    detail:
      `${newest.reason ? `${newest.reason}. ` : ""}` +
      (atExit(newest.reason)
        ? `Der Alarm von ${newest.camera} um ${hhmm(newest.at)} steht deshalb nicht in der Zentrale unter KI.`
        : "Text und Bild stehen in der Zentrale unter KI."),
  };
}

const atExit = (reason: string) => reason === OPEN_AT_EXIT || reason === OPEN_AT_EXIT_SEEN;

/**
 * Beim Laden der gespeicherten Liste: Alarme, die beim letzten Beenden noch
 * offen waren, zaehlen (fuer eine Zeile im Log) und als gesehen markieren,
 * damit ein weiterer Neustart sie nicht noch einmal nennt.
 */
export function markSeenAtExit(list: UndeliveredAlarm[]): { list: UndeliveredAlarm[]; fresh: number } {
  let fresh = 0;
  const out = list.map((a) => {
    if (a.reason !== OPEN_AT_EXIT) return a;
    fresh++;
    return { ...a, reason: OPEN_AT_EXIT_SEEN };
  });
  return { list: out, fresh };
}

/* ------------------------------------------- Zustellung gestoert (Liste fuer die Cloud) */

/** So lange darf ein Alarm unterwegs sein, ohne einen Chat erreicht zu haben, bevor die Zustellung als gestoert gilt. */
export const ALARM_SLOW_MS = 60_000;
/** So lange nach einem Alarm, der keinen Chat erreicht hat, gilt die Zustellung als gestoert. */
export const LOST_HOLD_MS = 15 * 60_000;
/** So lange darf der Empfang des Bots (getUpdates) scheitern, bevor die Zustellung als gestoert gilt. */
export const POLL_FAIL_MS = 2 * 60_000;

/**
 * Kommen Alarme des Waechters gerade an? Gestoert ist die Zustellung, wenn ein
 * Alarm seit ALARM_SLOW_MS unterwegs ist, ohne einen Chat erreicht zu haben,
 * wenn in den letzten LOST_HOLD_MS ein Alarm keinen Chat erreicht hat oder der
 * Bot seit POLL_FAIL_MS keine Updates abholen kann (Telegram nicht
 * erreichbar, Token ungueltig). Dann steht keine Kamera in der Liste fuer die
 * Cloud (sentinel-cover-rules.ts), und die Cloud meldet selbst. null = keine
 * Stoerung bekannt. Liegt ein Zeitpunkt in der Zukunft (Uhr zurueckgestellt),
 * laesst sich die Dauer nicht messen: Ein verlorener Alarm zaehlt dann als
 * frisch, ein Alarm unterwegs oder ein scheiternder Empfang als Stoerung.
 */
export function deliveryTrouble(i: { now: number; openSince: number | null; lastLostAt: number | null; pollFailingSince: number | null }): string | null {
  if (i.openSince !== null && i.openSince > i.now) return "Telegram-Zustellung gestört: Alarm unterwegs, die Uhr des Hubs wurde zurückgestellt";
  if (i.openSince !== null && i.now - i.openSince >= ALARM_SLOW_MS) {
    return `Telegram-Zustellung gestört: Alarm seit ${durationText(i.now - i.openSince)} unterwegs`;
  }
  if (i.lastLostAt !== null && i.now - i.lastLostAt < LOST_HOLD_MS) return `Telegram-Zustellung gestört: Alarm um ${hhmm(i.lastLostAt)} nicht zugestellt`;
  if (i.pollFailingSince !== null && i.pollFailingSince > i.now) {
    return "Telegram-Zustellung gestört: Bot nicht erreichbar, die Uhr des Hubs wurde zurückgestellt";
  }
  if (i.pollFailingSince !== null && i.now - i.pollFailingSince >= POLL_FAIL_MS) {
    return `Telegram-Zustellung gestört: Bot seit ${durationText(i.now - i.pollFailingSince)} nicht erreichbar`;
  }
  return null;
}
