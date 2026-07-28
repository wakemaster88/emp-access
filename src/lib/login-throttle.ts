/**
 * Einfache Bremse gegen automatisiertes Durchprobieren von Zugangsdaten.
 *
 * Bewusst nur im Arbeitsspeicher: das Projekt laeuft ohne Redis, und pro
 * Instanz greift die Bremse trotzdem. Der belastbare Schutz gegen das Raten
 * von Einmalcodes sitzt in der Datenbank (Sperre am Admin-Datensatz) – das
 * hier daempft nur den Ansturm davor.
 */

const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 20;
const MAX_KEYS = 5_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_KEYS) buckets.clear();
}

export function hitLoginThrottle(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size > 200) prune(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function clearLoginThrottle(key: string) {
  buckets.delete(key);
}

/** Nur fuer Tests. */
export function _resetLoginThrottle() {
  buckets.clear();
}
