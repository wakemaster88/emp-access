/**
 * Schlüssel im Link „Passwort zurücksetzen“ (`/app/<token>/neu/<schlüssel>`).
 * Ohne Datenbank, daher testbar.
 *
 * Aufbau: `<profilId>.<ablauf in Sekunden>.<HMAC>`. In die Signatur gehen die
 * `sessionVersion` und das Ende des Passwort-Hashes ein: Sobald ein neues
 * Passwort oder ein Passkey über den Link gesetzt ist (beides erhöht die
 * Version), gilt der Link nicht mehr. So ist er nur einmal nutzbar.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const RESET_LINK_MINUTES = 60;

export interface ResetKeyProfile {
  id: number;
  sessionVersion: number;
  passwordHash: string | null;
}

function mac(p: ResetKeyProfile, exp: number, secret: string): string {
  const hashTail = (p.passwordHash ?? "-").slice(-16);
  return createHmac("sha256", secret).update(`rider-reset|${p.id}|${p.sessionVersion}|${hashTail}|${exp}`).digest("base64url");
}

export function signResetKey(p: ResetKeyProfile, secret: string, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + RESET_LINK_MINUTES * 60;
  return `${p.id}.${exp}.${mac(p, exp, secret)}`;
}

/** Profil-ID aus dem Schlüssel (ungeprüft), um das Profil zu laden. */
export function resetKeyProfileId(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,12})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  return m ? Number(m[1]) : null;
}

/** Stimmt der Schlüssel für genau dieses Profil und ist er noch nicht abgelaufen? */
export function verifyResetKey(value: unknown, p: ResetKeyProfile, secret: string, now: Date = new Date()): boolean {
  if (typeof value !== "string" || !secret) return false;
  const m = /^(\d{1,12})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m || Number(m[1]) !== p.id) return false;
  const exp = Number(m[2]);
  if (exp * 1000 <= now.getTime()) return false;
  const expected = Buffer.from(mac(p, exp, secret));
  const given = Buffer.from(m[3]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Adresse für die Anzeige kürzen: „aa•••@gm•••.de“. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  const keep = (s: string, n: number) => (s.length <= n ? s.slice(0, 1) : s.slice(0, n)) + "•••";
  return `${keep(local, 2)}@${keep(host, 2)}${tld}`;
}
