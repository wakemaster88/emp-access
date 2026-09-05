/**
 * Einfache Anfragebremse im Arbeitsspeicher, pro Function-Instanz.
 *
 * Auf Vercel gibt es mehrere Instanzen, die Bremse ist also kein exaktes
 * Limit, sondern daempft Schleifen und Ansturm auf die oeffentlichen Token-
 * Endpunkte (Kiosk, Monitor, Scanner). Ein legitimer Kiosk liegt weit unter
 * den Grenzwerten; ein durchgedrehter Client oder ein geleaktes Token treffen
 * die Bremse sofort.
 */
import { NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

function prune(now: number) {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_KEYS) buckets.clear();
}

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterSec: number; remaining: number } {
  const now = Date.now();
  if (buckets.size > 500) prune(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterSec: 0, remaining: opts.limit - 1 };
  }
  b.count += 1;
  if (b.count > opts.limit) {
    return { allowed: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000), remaining: 0 };
  }
  return { allowed: true, retryAfterSec: 0, remaining: opts.limit - b.count };
}

/** Standard fuer schreibende Aufrufe ueber ein oeffentliches Token. */
export const PUBLIC_WRITE_LIMIT = { limit: 120, windowMs: 60_000 } as const;

/**
 * 429-Antwort, wenn das Token diesen Endpunkt zu oft aufruft; sonst null.
 * `scope` unterscheidet die Endpunkte, damit z. B. Scans ein Ticket-Anlegen
 * nicht mitblockieren.
 */
export function publicRateLimit(
  token: string,
  scope: string,
  opts: { limit: number; windowMs: number } = PUBLIC_WRITE_LIMIT,
): NextResponse | null {
  const r = checkRateLimit(`${scope}|${token}`, opts);
  if (r.allowed) return null;
  return NextResponse.json(
    { error: "Zu viele Anfragen. Bitte kurz warten.", retryAfterSec: r.retryAfterSec },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}

/** Nur fuer Tests. */
export function _resetRateLimits() {
  buckets.clear();
}
