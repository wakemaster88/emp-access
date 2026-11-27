import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Links in Newsletter-Mails: Bestätigen (Double-Opt-in) und Abmelden.
 *
 * Aufbau: <Zweck>.<Mandant>.<Abonnent>.<Aussendung>.<Tag>.<Signatur>
 *   Zweck       "c" bestätigen, "u" abmelden
 *   Aussendung  Id der Aussendung, über die abgemeldet wurde, sonst 0
 *   Tag         Ausstellungstag als Zahl (Tage seit 1970) – Bestätigungslinks
 *               laufen ab, Abmeldelinks nie
 *   Signatur    HMAC-SHA256 mit dem Schlüssel des Mandanten, 128 Bit, base64url
 * Der Schlüssel liegt in NewsletterConfig.tokenSecret und ändert sich nie.
 */

export type TokenPurpose = "c" | "u";

export interface LinkToken {
  purpose: TokenPurpose;
  accountId: number;
  subscriberId: number;
  campaignId: number;
  issuedDay: number;
}

/** Bestätigungslinks gelten 30 Tage. */
export const CONFIRM_TOKEN_DAYS = 30;

const DAY_MS = 86_400_000;

export function newTokenSecret(): string {
  return randomBytes(32).toString("base64url");
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`newsletter:${body}`).digest().subarray(0, 16).toString("base64url");
}

export function createLinkToken(
  secret: string,
  t: Omit<LinkToken, "issuedDay"> & { issuedDay?: number },
  now: Date = new Date(),
): string {
  const day = t.issuedDay ?? Math.floor(now.getTime() / DAY_MS);
  const body = [t.purpose, t.accountId, t.subscriberId, t.campaignId, day].join(".");
  return `${body}.${sign(secret, body)}`;
}

const TOKEN_RE = /^([cu])\.(\d{1,9})\.(\d{1,12})\.(\d{1,12})\.(\d{1,6})\.([A-Za-z0-9_-]{22})$/;

/** Teile des Tokens ohne Prüfung der Signatur (um den Mandanten zu finden). */
export function parseLinkToken(token: unknown): (LinkToken & { body: string; sig: string }) | null {
  if (typeof token !== "string") return null;
  const m = TOKEN_RE.exec(token.trim());
  if (!m) return null;
  return {
    purpose: m[1] as TokenPurpose,
    accountId: Number(m[2]),
    subscriberId: Number(m[3]),
    campaignId: Number(m[4]),
    issuedDay: Number(m[5]),
    body: m.slice(1, 6).join("."),
    sig: m[6],
  };
}

/**
 * Prüft Signatur, Zweck und (bei Bestätigung) das Alter. Liefert die Teile
 * oder null.
 */
export function verifyLinkToken(
  secret: string,
  token: unknown,
  purpose: TokenPurpose,
  now: Date = new Date(),
): LinkToken | null {
  const parsed = parseLinkToken(token);
  if (!parsed || parsed.purpose !== purpose) return null;
  const expected = Buffer.from(sign(secret, parsed.body));
  const given = Buffer.from(parsed.sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (purpose === "c") {
    const age = Math.floor(now.getTime() / DAY_MS) - parsed.issuedDay;
    if (age < 0 || age > CONFIRM_TOKEN_DAYS) return null;
  }
  const { body: _b, sig: _s, ...rest } = parsed;
  void _b;
  void _s;
  return rest;
}
