/**
 * Sitzung der Kunden-App: signierter Wert für das Cookie, ohne Datenbank.
 *
 * Aufbau: `<profilId>.<sessionVersion>.<ablauf in Sekunden>.<HMAC>`. Die
 * `sessionVersion` steht am Profil; wird sie erhöht (Zugang zurückgesetzt),
 * gelten alle älteren Cookies nicht mehr.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const RIDER_COOKIE = "rider_session";
export const RIDER_SESSION_DAYS = 180;
export const RIDER_PASSWORD_MIN = 8;
export const RIDER_PASSWORD_MAX = 200;

export interface RiderSession {
  profileId: number;
  version: number;
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`rider-session|${payload}`).digest("base64url");
}

export function signRiderSession(s: RiderSession, secret: string, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + RIDER_SESSION_DAYS * 86_400;
  const payload = `${s.profileId}.${s.version}.${exp}`;
  return `${payload}.${mac(payload, secret)}`;
}

/** Liefert die Sitzung, wenn Signatur und Ablauf stimmen, sonst null. */
export function verifyRiderSession(value: string | undefined, secret: string, now: Date = new Date()): RiderSession | null {
  if (!value || !secret) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [id, version, exp, sig] = parts;
  if (![id, version, exp].every((p) => /^\d{1,12}$/.test(p))) return null;
  const expected = Buffer.from(mac(`${id}.${version}.${exp}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) * 1000 <= now.getTime()) return null;
  return { profileId: Number(id), version: Number(version) };
}

/** Prüft ein neues Passwort; liefert den Fehlertext oder null. */
export function riderPasswordError(password: unknown): string | null {
  if (typeof password !== "string") return "Bitte ein Passwort eingeben.";
  if (password.length < RIDER_PASSWORD_MIN) return `Das Passwort braucht mindestens ${RIDER_PASSWORD_MIN} Zeichen.`;
  if (password.length > RIDER_PASSWORD_MAX) return "Das Passwort ist zu lang.";
  return null;
}
