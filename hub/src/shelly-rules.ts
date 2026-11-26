/**
 * Regeln der Shelly-Anbindung (shelly.ts), ohne Netz testbar
 * (shelly-rules.test.ts).
 *
 *   - Generation je Geraet: /shelly liefert sie, sie aendert sich nicht.
 *     Der Hub merkt sie sich eine Stunde und verwirft sie beim ersten Fehler
 *     einer Anfrage an dieses Geraet.
 *   - Wiederholung eines Schaltbefehls: genau einmal nach 400 ms, nur fuer
 *     „an“ und „aus“. „Aus“ nach einem Netzfehler oder einer
 *     Zeitueberschreitung; „an“ nur, wenn die Verbindung gar nicht zustande
 *     kam (hold-rules.ts NOT_SENT_CODES). Ein „an“, das vielleicht
 *     angekommen ist, startet sonst eine am Geraet eingestellte
 *     Selbstabschaltung (Tueroeffner) neu. Nie fuer Umschalten (ein zweites Umschalten
 *     haette die Wirkung wieder aufgehoben) und nie fuer einen Impuls (an
 *     mit Selbstabschaltung, etwa Tueroeffner oder die Fahrt eines Rolltors:
 *     die Selbstabschaltung begaenne von vorn). Ein abgelehntes Passwort
 *     (auth-latch.ts) wird nie wiederholt, eine HTTP-Fehlerantwort auch
 *     nicht (das Geraet hat geantwortet). Kommt inzwischen ein neuerer
 *     Befehl fuer denselben Kanal, entfaellt die Wiederholung (shelly.ts).
 */

import { NOT_SENT_CODES } from "./hold-rules.js";

export const SHELLY_GEN_CACHE_MS = 3_600_000;
export const SHELLY_SWITCH_RETRY_MS = 400;

export type ShellyAction = "on" | "off" | "toggle" | "pulse";
export type ShellyErrorKind = "network" | "timeout" | "http" | "auth" | "other";

/** Art eines Schaltbefehls: an mit Selbstabschaltung ist ein Impuls. */
export function shellyAction(on: boolean | "toggle", autoOffSec?: number | null): ShellyAction {
  if (on === "toggle") return "toggle";
  if (on && autoOffSec && autoOffSec > 0) return "pulse";
  return on ? "on" : "off";
}

const NET_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ETIMEDOUT", "EPIPE", "ECONNABORTED"]);

/** Fehler einer Anfrage einordnen (fetch, Zeitlimit, HTTP-Status, Passwort). */
export function shellyErrorKind(e: unknown): ShellyErrorKind {
  const err = e as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; name?: unknown } } | null;
  if (!err || typeof err !== "object") return "other";
  if (err.name === "TimeoutError" || err.name === "AbortError" || err.cause?.name === "ConnectTimeoutError") return "timeout";
  const msg = typeof err.message === "string" ? err.message : "";
  if (/Passwort/i.test(msg)) return "auth";
  if (/^HTTP \d{3}$/.test(msg)) return "http";
  const code = typeof err.cause?.code === "string" ? err.cause.code : typeof err.code === "string" ? err.code : "";
  if (NET_CODES.has(code)) return code === "ETIMEDOUT" ? "timeout" : "network";
  if (err.name === "TypeError" && msg === "fetch failed") return "network";
  return "other";
}

/** Kam die Anfrage sicher nicht beim Geraet an (keine Verbindung zustande gekommen)? */
export function shellyNotSent(e: unknown): boolean {
  const err = e as { code?: unknown; cause?: { code?: unknown; name?: unknown } } | null;
  if (!err || typeof err !== "object") return false;
  if (err.cause?.name === "ConnectTimeoutError") return true;
  const code = typeof err.cause?.code === "string" ? err.cause.code : typeof err.code === "string" ? err.code : "";
  return NOT_SENT_CODES.has(code);
}

/**
 * Darf ein gescheiterter Schaltbefehl einmal wiederholt werden? `notSent`:
 * die Verbindung kam nicht zustande (shellyNotSent).
 */
export function retryable(action: ShellyAction, kind: ShellyErrorKind, notSent = false): boolean {
  if (kind !== "network" && kind !== "timeout") return false;
  if (action === "off") return true;
  return action === "on" && notSent;
}

/** Gemerkte Generation noch gueltig? */
export function genCacheFresh(entry: { at: number } | undefined, now: number): boolean {
  return !!entry && now - entry.at < SHELLY_GEN_CACHE_MS && now >= entry.at;
}
