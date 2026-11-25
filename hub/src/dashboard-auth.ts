/**
 * Anmeldung am lokalen Dashboard – reine Logik ohne Hub-Konfiguration
 * (testbar, dashboard-auth.test.ts).
 *
 *  - Cookie-Wert: abgeleitet aus dem Token (HMAC-SHA256 eines festen Labels,
 *    Token als Schluessel, base64url). Das Cookie enthaelt so nicht das Token
 *    selbst, das auch im Header und in der Adresse gilt. Aendert sich das
 *    Token, aendert sich auch der Cookie-Wert – alle Geraete sind dann wie
 *    bisher abgemeldet. Cookies aus der Zeit davor (Token im Klartext) gelten
 *    weiter und werden beim naechsten Seitenaufruf ersetzt.
 *  - Fehlversuche je Client-Adresse: nach 20 ungueltigen Anmeldedaten in
 *    15 Minuten (gleitendes Fenster) antwortet das Dashboard dieser Adresse 15 Minuten mit 429.
 *  - Zugriffsart (nur lokal / im Netz mit Token / im Netz ohne Token) fuer
 *    Start-Log und Heartbeat.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Festes Label fuer den abgeleiteten Cookie-Wert. Aendern = alle abmelden. */
const COOKIE_LABEL = "emp-hub-dashboard-cookie-v1";

/** Cookie-Wert zu einem Token (base64url, ohne Sonderzeichen fuer den Cookie-Header). */
export function cookieValueFor(token: string): string {
  return createHmac("sha256", token).update(COOKIE_LABEL).digest("base64url");
}

/** Laengenunabhaengiger Vergleich ueber Digests. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Prueft einen Cookie-Wert: "derived" = neuer abgeleiteter Wert,
 * "legacy" = Token im Klartext (Cookie von vor der Umstellung), null = ungueltig.
 */
export function checkCookieValue(given: string, token: string): "derived" | "legacy" | null {
  if (!given || !token) return null;
  if (sameSecret(given, cookieValueFor(token))) return "derived";
  if (sameSecret(given, token)) return "legacy";
  return null;
}

/** Client-Adresse als Schluessel: IPv4 in IPv6-Schreibweise ohne Praefix. */
export function clientKey(remoteAddress: string | undefined): string {
  const a = (remoteAddress ?? "").trim().toLowerCase();
  return a.startsWith("::ffff:") && a.includes(".") ? a.slice(7) : a || "?";
}

/* ---------------------------------------------------------------------------
 * Fehlversuche je Adresse
 * ------------------------------------------------------------------------- */

export interface AttemptLimitOptions {
  /** Fehlversuche im Fenster, ab denen gesperrt wird. */
  maxFailures: number;
  windowMs: number;
  blockMs: number;
  /** Hoechstens so viele Adressen im Speicher; die aelteste faellt zuerst raus. */
  maxEntries: number;
}

export const DEFAULT_ATTEMPT_LIMIT: AttemptLimitOptions = {
  maxFailures: 20,
  windowMs: 15 * 60_000,
  blockMs: 15 * 60_000,
  maxEntries: 1000,
};

interface AttemptEntry {
  /** Zeitpunkte der gezaehlten Fehlversuche im gleitenden Fenster (hoechstens maxFailures). */
  failures: number[];
  blockedUntil: number;
  /** Fingerabdruecke der zuletzt abgelehnten Werte (dasselbe alte Cookie zaehlt nur einmal). */
  recent: { fp: string; at: number }[];
}

/** So viele abgelehnte Werte merkt sich der Zaehler je Adresse. */
const RECENT_VALUES = 8;

export class AttemptLimiter {
  private readonly entries = new Map<string, AttemptEntry>();
  constructor(private readonly opts: AttemptLimitOptions = DEFAULT_ATTEMPT_LIMIT) {}

  /** Restdauer der Sperre in ms, 0 = nicht gesperrt. */
  blockedFor(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    if (!e || e.blockedUntil <= now) return 0;
    return e.blockedUntil - now;
  }

  /**
   * Einen ungueltigen Versuch zaehlen. `value` ist der abgelehnte Wert:
   * Ein Wert, der im Fenster schon abgelehnt wurde, zaehlt nicht erneut – so
   * sperrt sich ein offener Tab mit veraltetem Cookie nicht selbst, waehrend
   * jeder neue geratene Wert zaehlt. Gibt true zurueck, wenn die Adresse
   * mit diesem Versuch gesperrt wurde.
   */
  recordFailure(key: string, value: string, now = Date.now()): boolean {
    const fp = createHash("sha256").update(value).digest("base64url");
    let e = this.entries.get(key);
    if (e && e.blockedUntil > now) return false;
    if (!e || e.blockedUntil > 0) e = { failures: [], blockedUntil: 0, recent: [] };
    // Gleitendes Fenster: nur Fehlversuche der letzten windowMs zaehlen.
    const since = now - this.opts.windowMs;
    e.failures = e.failures.filter((t) => t > since);
    e.recent = e.recent.filter((r) => r.at > since);
    const seen = e.recent.find((r) => r.fp === fp);
    if (seen) {
      seen.at = now;
      this.touch(key, e);
      return false;
    }
    e.failures.push(now);
    e.recent.push({ fp, at: now });
    if (e.recent.length > RECENT_VALUES) e.recent.shift();
    const blocked = e.failures.length >= this.opts.maxFailures;
    if (blocked) e.blockedUntil = now + this.opts.blockMs;
    this.touch(key, e);
    return blocked;
  }

  /** Erfolgreiche Anmeldung: Zaehler dieser Adresse loeschen. */
  clear(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Neu einsortieren (Map-Reihenfolge = zuletzt geaendert) und begrenzen. */
  private touch(key: string, e: AttemptEntry): void {
    this.entries.delete(key);
    this.entries.set(key, e);
    while (this.entries.size > this.opts.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/* ---------------------------------------------------------------------------
 * Zugriffsart
 * ------------------------------------------------------------------------- */

export type DashboardAccess = "local" | "lan-token" | "lan-open";

const LOOPBACK_BIND = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Wie das Dashboard erreichbar ist – aus Bind-Adresse und Token. */
export function dashboardAccessMode(bindHost: string, token: string): DashboardAccess {
  if (LOOPBACK_BIND.has(bindHost.trim().toLowerCase())) return "local";
  return token ? "lan-token" : "lan-open";
}
