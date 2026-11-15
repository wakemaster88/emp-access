/**
 * Anmeldung an der Kunden-App.
 *
 * Der Link `/app/<token>` ist nur die Einladung: Beim ersten Öffnen richtet
 * der Fahrer ein Passwort oder einen Passkey ein. Danach reicht der Link
 * allein nicht mehr, jede Seite und jede Schnittstelle verlangt die Sitzung.
 * Wer den Zugang verliert, bekommt ihn an der Kasse zurückgesetzt.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "./prisma";
import { CHALLENGE_TTL_MS } from "./passkey";
import type { RelyingParty } from "./passkey-utils";
import { loadRider, newRiderToken, riderAppPath, type RiderView } from "./rider-app";
import { RIDER_COOKIE, RIDER_SESSION_DAYS, signRiderSession, verifyRiderSession } from "./rider-session";

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const MAX_PASSKEYS = 5;
const TIMEOUT_MS = 120_000;

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

export interface RiderAuthProfile {
  id: number;
  accountId: number;
  token: string;
  passwordHash: string | null;
  sessionVersion: number;
  loginFailures: number;
  loginLockedUntil: Date | null;
  passkeyCount: number;
}

export async function findRiderAuthProfile(token: string): Promise<RiderAuthProfile | null> {
  if (!token || token.length < 16) return null;
  const p = await prisma.riderProfile.findUnique({
    where: { token },
    select: {
      id: true,
      accountId: true,
      token: true,
      passwordHash: true,
      sessionVersion: true,
      loginFailures: true,
      loginLockedUntil: true,
      account: { select: { isActive: true } },
      _count: { select: { passkeys: true, tickets: true } },
    },
  });
  if (!p || !p.account.isActive || p._count.tickets === 0) return null;
  return {
    id: p.id,
    accountId: p.accountId,
    token: p.token,
    passwordHash: p.passwordHash,
    sessionVersion: p.sessionVersion,
    loginFailures: p.loginFailures,
    loginLockedUntil: p.loginLockedUntil,
    passkeyCount: p._count.passkeys,
  };
}

export function hasCredential(p: RiderAuthProfile): boolean {
  return p.passwordHash != null || p.passkeyCount > 0;
}

async function hasSession(p: RiderAuthProfile): Promise<boolean> {
  const jar = await cookies();
  const s = verifyRiderSession(jar.get(RIDER_COOKIE)?.value, secret());
  return !!s && s.profileId === p.id && s.version === p.sessionVersion;
}

export type RiderAccess = "setup" | "login" | "ok";

/** Was der Besucher dieses Links darf: einrichten, anmelden oder hinein. */
export async function riderAccess(p: RiderAuthProfile): Promise<RiderAccess> {
  if (!hasCredential(p)) return "setup";
  return (await hasSession(p)) ? "ok" : "login";
}

/**
 * Für jede Seite der App: liefert den Fahrer oder leitet zum Einrichten bzw.
 * Anmelden um. Je Request nur einmal (Layout und Seite teilen das Ergebnis).
 */
export const requireRider = cache(async (token: string): Promise<RiderView> => {
  const profile = await findRiderAuthProfile(token);
  if (!profile) notFound();
  const access = await riderAccess(profile);
  if (access === "setup") redirect(`${riderAppPath(token)}/einrichten`);
  if (access === "login") redirect(`${riderAppPath(token)}/anmelden`);
  const rider = await loadRider(token);
  if (!rider) notFound();
  return rider;
});

/** Für Schnittstellen: Profil mit gültiger Sitzung oder eine Fehlerantwort. */
export async function riderApiSession(
  token: string,
): Promise<{ profile: RiderAuthProfile } | { error: NextResponse }> {
  const profile = await findRiderAuthProfile(token);
  if (!profile) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  if (!hasCredential(profile) || !(await hasSession(profile))) {
    return { error: NextResponse.json({ error: "Bitte melde dich neu an." }, { status: 401 }) };
  }
  return { profile };
}

/**
 * Wer darf eine Anmeldung hinterlegen? Beim ersten Mal jeder mit dem
 * Einladungslink, danach nur noch die angemeldete Person.
 */
export async function mayManageCredentials(p: RiderAuthProfile): Promise<boolean> {
  return !hasCredential(p) || (await hasSession(p));
}

export function setRiderCookie(res: NextResponse, p: { id: number; sessionVersion: number }): NextResponse {
  res.cookies.set(RIDER_COOKIE, signRiderSession({ profileId: p.id, version: p.sessionVersion }, secret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: RIDER_SESSION_DAYS * 86_400,
  });
  return res;
}

export function clearRiderCookie(res: NextResponse): NextResponse {
  res.cookies.set(RIDER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export function hashRiderPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function isLocked(p: RiderAuthProfile, now: Date = new Date()): boolean {
  return !!p.loginLockedUntil && p.loginLockedUntil.getTime() > now.getTime();
}

/** Passwort prüfen; zählt Fehlversuche und sperrt nach fünf für 15 Minuten. */
export async function checkRiderPassword(p: RiderAuthProfile, password: unknown): Promise<"ok" | "wrong" | "locked"> {
  if (isLocked(p)) return "locked";
  const ok = typeof password === "string" && !!p.passwordHash && (await bcrypt.compare(password, p.passwordHash));
  if (ok) {
    if (p.loginFailures > 0 || p.loginLockedUntil) {
      await prisma.riderProfile.update({ where: { id: p.id }, data: { loginFailures: 0, loginLockedUntil: null } });
    }
    return "ok";
  }
  const failures = p.loginFailures + 1;
  await prisma.riderProfile.update({
    where: { id: p.id },
    data:
      failures >= MAX_FAILURES
        ? { loginFailures: 0, loginLockedUntil: new Date(Date.now() + LOCK_MS) }
        : { loginFailures: failures },
  });
  return "wrong";
}

// ---------------------------------------------------------------- Passkeys

function purpose(kind: "login" | "register", profileId: number): string {
  return `rider-${kind}:${profileId}`;
}

async function storeChallenge(challenge: string, p: string) {
  const now = new Date();
  await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.passkeyChallenge.create({
    data: { challenge, purpose: p, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) },
  });
}

/** Einmal gültig: das Löschen ist atomar, ein zweiter Versuch scheitert. */
async function consumeChallenge(challenge: string, p: string): Promise<boolean> {
  const { count } = await prisma.passkeyChallenge.deleteMany({
    where: { challenge, purpose: p, expiresAt: { gt: new Date() } },
  });
  return count === 1;
}

export async function riderRegistrationOptions(rp: RelyingParty, p: RiderAuthProfile, label: string) {
  const existing = await prisma.riderPasskey.findMany({
    where: { profileId: p.id },
    select: { credentialId: true, transports: true },
  });
  if (existing.length >= MAX_PASSKEYS) return null;
  const options = await generateRegistrationOptions({
    rpName: "Deine Saison",
    rpID: rp.rpID,
    userName: label,
    userDisplayName: label,
    userID: new TextEncoder().encode(`emp-rider-${p.id}`),
    timeout: TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: existing.map((k) => ({ id: k.credentialId, transports: k.transports as never })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await storeChallenge(options.challenge, purpose("register", p.id));
  return options;
}

export async function riderVerifyRegistration(
  rp: RelyingParty,
  p: RiderAuthProfile,
  response: RegistrationResponseJSON,
  name: string,
): Promise<boolean> {
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) => consumeChallenge(challenge, purpose("register", p.id)),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch {
    return false;
  }
  if (!result.verified) return false;
  const info = result.registrationInfo;
  const exists = await prisma.riderPasskey.findUnique({ where: { credentialId: info.credential.id } });
  if (exists) return false;
  await prisma.riderPasskey.create({
    data: {
      profileId: p.id,
      accountId: p.accountId,
      credentialId: info.credential.id,
      publicKey: new Uint8Array(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      name,
    },
  });
  return true;
}

export async function riderLoginOptions(rp: RelyingParty, p: RiderAuthProfile) {
  const keys = await prisma.riderPasskey.findMany({
    where: { profileId: p.id },
    select: { credentialId: true, transports: true },
  });
  if (keys.length === 0) return null;
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    timeout: TIMEOUT_MS,
    userVerification: "required",
    allowCredentials: keys.map((k) => ({ id: k.credentialId, transports: k.transports as never })),
  });
  await storeChallenge(options.challenge, purpose("login", p.id));
  return options;
}

export async function riderVerifyLogin(
  rp: RelyingParty,
  p: RiderAuthProfile,
  response: AuthenticationResponseJSON,
): Promise<boolean> {
  if (!response || typeof response.id !== "string") return false;
  const key = await prisma.riderPasskey.findUnique({ where: { credentialId: response.id } });
  if (!key || key.profileId !== p.id) return false;
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => consumeChallenge(challenge, purpose("login", p.id)),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: key.credentialId,
        publicKey: new Uint8Array(key.publicKey),
        counter: key.counter,
        transports: key.transports as never,
      },
    });
  } catch {
    return false;
  }
  if (!verified.verified) return false;
  await prisma.riderPasskey.update({
    where: { id: key.id },
    data: {
      counter: verified.authenticationInfo.newCounter,
      backedUp: verified.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date(),
    },
  });
  return true;
}

/**
 * Zugang zurücksetzen (Verwaltung): Passwort und Passkeys weg, alle
 * Sitzungen beendet, neuer Einladungslink. Der alte Link gilt nicht mehr.
 */
export async function resetRiderAccess(profileId: number, accountId: number): Promise<string | null> {
  const token = newRiderToken();
  const [, updated] = await prisma.$transaction([
    prisma.riderPasskey.deleteMany({ where: { profileId, accountId } }),
    prisma.riderProfile.updateMany({
      where: { id: profileId, accountId },
      data: {
        token,
        passwordHash: null,
        loginFailures: 0,
        loginLockedUntil: null,
        sessionVersion: { increment: 1 },
      },
    }),
  ]);
  if (updated.count !== 1) return null;
  // Die bisherigen Geräte gehören womöglich nicht mehr dem Fahrer.
  await prisma.riderPushSubscription.deleteMany({ where: { profileId, accountId } });
  return token;
}
