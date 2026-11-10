import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Shared Secret zwischen Next-App und Tracker-Sidecar.
 *
 * Die Admin-PIN reicht dafür nicht: der Kiosk-Browser hat sie (Cookie)
 * ebenfalls, und ohne PIN ist ohnehin alles offen. Der Sidecar liest das
 * Token direkt aus der gemeinsamen `config.json` (`internalToken`) und
 * schickt es als Header mit; ein Browser bekommt es nie zu sehen
 * (`lib/config-secrets.ts` entfernt es aus jeder API-Antwort).
 *
 * Bewusst ohne Config-/FS-Abhängigkeit, damit ohne HTTP-Kontext testbar.
 */

export const INTERNAL_TOKEN_HEADER = "x-internal-token";

export function generateInternalToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Timing-sicherer Vergleich. Ohne konfiguriertes Token oder ohne Header
 * gilt der Aufruf nie als intern (fail closed).
 */
export function verifyInternalToken(
  expected: string,
  presented: string | null | undefined,
): boolean {
  if (!expected || !presented) return false;
  // Über SHA-256 vergleichen: gleiche Länge für timingSafeEqual, und die
  // Länge des echten Tokens lässt sich nicht über die Laufzeit erraten.
  const a = createHash("sha256").update(expected, "utf8").digest();
  const b = createHash("sha256").update(presented, "utf8").digest();
  return timingSafeEqual(a, b);
}
