import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * TOTP nach RFC 6238 (HMAC-SHA1, 6 Stellen, 30 Sekunden) – kompatibel mit
 * Google Authenticator, Microsoft Authenticator, 1Password, Aegis usw.
 *
 * Bewusst ohne zusaetzliche Abhaengigkeit: der Algorithmus ist klein und
 * gegen die Testvektoren aus dem RFC geprueft (scripts/totp-check.ts).
 */

export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
/** Ein Schritt Toleranz nach vorn und hinten faengt Uhrendrift des Handys ab. */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Ungueltiges Base32-Zeichen");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-Bit-Secret – die von RFC 4226 empfohlene Laenge fuer HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentTotpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SEC);
}

export function totpCodeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function normalizeTotpCode(input: string): string {
  return input.replace(/\D/g, "");
}

function codesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Prueft einen Code gegen das Zeitfenster und liefert den passenden Zeitschritt
 * zurueck (oder null). Der Schritt wird vom Aufrufer gespeichert, damit
 * derselbe Code nicht ein zweites Mal akzeptiert wird.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { atMs?: number; window?: number } = {}
): number | null {
  const normalized = normalizeTotpCode(code);
  if (normalized.length !== TOTP_DIGITS) return null;

  const center = currentTotpStep(options.atMs ?? Date.now());
  const window = options.window ?? TOTP_WINDOW;

  let matched: number | null = null;
  for (let offset = -window; offset <= window; offset++) {
    const step = center + offset;
    if (step < 0) continue;
    // Kein vorzeitiges Verlassen der Schleife: die Laufzeit soll nicht
    // verraten, welcher Schritt getroffen hat.
    if (codesMatch(totpCodeForStep(secret, step), normalized) && matched === null) {
      matched = step;
    }
  }
  return matched;
}

export function otpauthUrl(params: { secret: string; account: string; issuer: string }): string {
  const label = `${params.issuer}:${params.account}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

/** Secret in Vierergruppen – erleichtert das Abtippen ohne Kamera. */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

// Ohne 0/O/1/I/L, damit abgeschriebene Codes nicht an Verwechslungen scheitern.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_GROUPS = 2;
const RECOVERY_GROUP_LEN = 5;

export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < RECOVERY_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < RECOVERY_GROUP_LEN; i++) {
      group += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/** Vergleichsform: ohne Trenner, in Grossbuchstaben. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function looksLikeRecoveryCode(input: string): boolean {
  return normalizeRecoveryCode(input).length === RECOVERY_GROUPS * RECOVERY_GROUP_LEN;
}
