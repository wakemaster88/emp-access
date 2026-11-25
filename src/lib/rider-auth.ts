/**
 * Anmeldung an der Kunden-App.
 *
 * Der Link `/app/<token>` ist nur die Einladung: Beim ersten Öffnen richtet
 * der Fahrer ein Passwort oder einen Passkey ein. Danach reicht der Link
 * allein nicht mehr, jede Seite und jede Schnittstelle verlangt die Sitzung.
 * Der Link aus der Anmelde-Mail (`/app/mail/…`) belegt die Adresse und meldet
 * direkt an (`mailLinkSession`). Passwort vergessen: Link zum Neufestlegen per
 * Mail (lib/rider-reset), oder an der Kasse zurücksetzen lassen.
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
import { loadRiderCached, newRiderToken, type RiderView } from "./rider-app";
import { riderHome } from "./rider-base";
import { familyRelation, loadFamilyMembers, memberName, type FamilyMember, type FamilyPerson, type FamilyRelation } from "./rider-family";
import { RIDER_COOKIE, RIDER_SESSION_DAYS, signRiderSession, verifyRiderSession } from "./rider-session";
import { riderResetKeyValid } from "./rider-reset";
import { keyedFingerprint } from "./secret-box";
import {
  clearLoginFailures, isKnownLoginIp, lockLoginIfExhausted, loginIpHash, loginSlowdownMs, pruneLoginLocks,
  releaseLoginAttempt, reserveLoginAttempt, waitForLoginPaceSlot, type LoginLockKey,
} from "./login-lockout";

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
  familyId: number | null;
  familyAdult: boolean;
  /** Bestätigte Adresse der Person; null ohne eigene Adresse. */
  email: string | null;
  /** Kundenkonto der Person (lib/customers). */
  customerId: number | null;
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
      familyId: true,
      familyAdult: true,
      email: true,
      customerId: true,
      account: { select: { isActive: true } },
      _count: { select: { passkeys: true, tickets: true } },
    },
  });
  // Ohne Ticket gilt ein Profil nur mit bestätigter Adresse (Kunde noch ohne Abo).
  if (!p || !p.account.isActive || (p._count.tickets === 0 && !p.email)) return null;
  return {
    id: p.id,
    accountId: p.accountId,
    token: p.token,
    passwordHash: p.passwordHash,
    sessionVersion: p.sessionVersion,
    loginFailures: p.loginFailures,
    loginLockedUntil: p.loginLockedUntil,
    passkeyCount: p._count.passkeys,
    familyId: p.familyId,
    familyAdult: p.familyAdult,
    email: p.email,
    customerId: p.customerId,
  };
}

/** Wie `findRiderAuthProfile`, je Request nur einmal (Seiten und Layouts der App; nicht für Schnittstellen, die danach schreiben). */
export const findRiderAuthProfileCached = cache(findRiderAuthProfile);

export function hasCredential(p: RiderAuthProfile): boolean {
  return p.passwordHash != null || p.passkeyCount > 0;
}

async function hasSession(p: RiderAuthProfile): Promise<boolean> {
  const jar = await cookies();
  const s = verifyRiderSession(jar.get(RIDER_COOKIE)?.value, secret());
  return !!s && s.profileId === p.id && s.version === p.sessionVersion;
}

/**
 * Wer auf diesem Gerät angemeldet ist, unabhängig vom Link in der Adresse.
 * Je Request nur einmal. Null ohne gültige Sitzung.
 */
export const sessionRider = cache(async (): Promise<(FamilyPerson & { token: string }) | null> => {
  const jar = await cookies();
  const s = verifyRiderSession(jar.get(RIDER_COOKIE)?.value, secret());
  if (!s) return null;
  const p = await prisma.riderProfile.findUnique({
    where: { id: s.profileId },
    select: {
      id: true, accountId: true, token: true, sessionVersion: true, familyId: true, familyAdult: true, passwordHash: true, email: true,
      account: { select: { isActive: true } },
      _count: { select: { passkeys: true, tickets: true } },
    },
  });
  if (!p || !p.account.isActive || p.sessionVersion !== s.version || (p._count.tickets === 0 && !p.email)) return null;
  if (p.passwordHash == null && p._count.passkeys === 0) return null;
  return { id: p.id, accountId: p.accountId, token: p.token, familyId: p.familyId, familyAdult: p.familyAdult };
});

/**
 * Verhältnis der angemeldeten Person zu diesem Profil: sie selbst, ein Kind
 * ihrer Familie (verwalten), der Partner (ansehen) oder nichts.
 */
export async function riderRelation(p: RiderAuthProfile): Promise<FamilyRelation> {
  if (hasCredential(p) && (await hasSession(p))) return "self";
  const rel = familyRelation(await sessionRider(), p);
  return rel === "self" ? null : rel;
}

export type RiderAccess = "setup" | "login" | "ok" | "held";

/** Zugang, der eine Person ohne eigenen Zugang schon mitverwaltet. */
export interface RiderHolder {
  token: string;
  name: string;
}

/**
 * Ist das Konto schon aktiv? Eine Person ohne eigene Adresse und ohne eigenen
 * Zugang gehört dann zu einem eingerichteten Zugang: als Kind einer Familie,
 * deren Erwachsene sich angemeldet haben, oder als Person eines
 * Kundenkontos, dessen Adresse schon einen Zugang hat. Ihr Link richtet dann
 * keinen zweiten Zugang mehr ein (Aaron, 20.11.2026: „die seite nur …
 * wenn konto noch nicht aktiv“). Null: die Person darf selbst einrichten.
 */
export async function riderHolder(p: RiderAuthProfile): Promise<RiderHolder | null> {
  if (hasCredential(p) || p.email != null) return null;
  const withLogin = { OR: [{ passwordHash: { not: null } }, { passkeys: { some: {} } }] };
  const select = { token: true, firstName: true, nickname: true, tickets: { select: { firstName: true, name: true, endDate: true, subscriptionId: true }, orderBy: { id: "desc" as const }, take: 5 } };
  let holder =
    p.familyId != null && !p.familyAdult
      ? await prisma.riderProfile.findFirst({
          where: { accountId: p.accountId, familyId: p.familyId, familyAdult: true, id: { not: p.id }, ...withLogin },
          select,
          orderBy: { id: "asc" },
        })
      : null;
  if (!holder && p.customerId != null) {
    const konto = await prisma.customer.findFirst({ where: { id: p.customerId, accountId: p.accountId }, select: { email: true, aliasEmails: true } });
    if (konto) {
      holder = await prisma.riderProfile.findFirst({
        where: { accountId: p.accountId, customerId: p.customerId, id: { not: p.id }, email: { in: [konto.email, ...konto.aliasEmails] }, ...withLogin },
        select,
        orderBy: { id: "asc" },
      });
    }
  }
  return holder ? { token: holder.token, name: memberName(holder) } : null;
}

/** Was der Besucher dieses Links darf: einrichten, anmelden, hinein oder („held“) beim Konto anmelden. */
export async function riderAccess(p: RiderAuthProfile): Promise<RiderAccess> {
  if ((await riderRelation(p)) != null) return "ok";
  if (hasCredential(p)) return "login";
  return (await riderHolder(p)) ? "held" : "setup";
}

export interface RiderFamilyView {
  /** "self": eigenes Profil; "manage": Kind der Familie; "view": Partner. */
  relation: "self" | "manage" | "view";
  /** Link der angemeldeten Person (zurück zu „Ich“). */
  viewerToken: string;
  /** Mitglieder, wenn die angemeldete Person Erwachsene einer Familie ist; sonst leer. */
  members: FamilyMember[];
  /** Die angemeldete Person gehört als Kind zu einer Familie. */
  childOfFamily: boolean;
}

/** Familien-Sicht für Layout und Profil; setzt eine erlaubte Sitzung voraus. */
export const riderFamilyView = cache(async (token: string): Promise<RiderFamilyView | null> => {
  const profile = await findRiderAuthProfileCached(token);
  if (!profile) return null;
  const relation = await riderRelation(profile);
  if (!relation) return null;
  const viewer = relation === "self" ? { ...profile } : await sessionRider();
  if (!viewer) return null;
  const members = viewer.familyId != null && viewer.familyAdult ? await loadFamilyMembers(viewer.familyId, viewer.accountId) : [];
  return {
    relation,
    viewerToken: viewer.token,
    members,
    childOfFamily: viewer.familyId != null && !viewer.familyAdult,
  };
});

/**
 * Für jede Seite der App: liefert den Fahrer oder leitet zum Einrichten bzw.
 * Anmelden um. Je Request nur einmal (Layout und Seite teilen das Ergebnis).
 */
export const requireRider = cache(async (token: string): Promise<RiderView> => {
  const profile = await findRiderAuthProfileCached(token);
  if (!profile) notFound();
  const access = await riderAccess(profile);
  if (access === "setup" || access === "held") redirect(`${await riderHome(token)}/einrichten`);
  if (access === "login") redirect(`${await riderHome(token)}/anmelden`);
  // Erst nach der Prüfung: nur angemeldete Aufrufe ordnen Tagestickets zu und merken „zuletzt gesehen“.
  const rider = await loadRiderCached(token);
  if (!rider) notFound();
  return rider;
});

/**
 * Für Schnittstellen, die auch Eltern für ihr Kind aufrufen dürfen: Profil mit
 * dem Verhältnis "self" oder "manage", sonst eine Fehlerantwort.
 */
export async function riderApiManage(
  token: string,
): Promise<{ profile: RiderAuthProfile; relation: "self" | "manage" } | { error: NextResponse }> {
  const profile = await findRiderAuthProfile(token);
  if (!profile) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  const relation = await riderRelation(profile);
  if (relation !== "self" && relation !== "manage") {
    return { error: NextResponse.json({ error: "Bitte melde dich neu an." }, { status: 401 }) };
  }
  return { profile, relation };
}

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
 * Einladungslink, solange das Konto nicht schon aktiv ist (`riderHolder`),
 * danach nur noch die angemeldete Person.
 */
export async function mayManageCredentials(p: RiderAuthProfile, resetKey?: unknown): Promise<boolean> {
  if (resetKey != null && riderResetKeyValid(p, resetKey)) return true;
  if (!hasCredential(p)) return (await riderHolder(p)) == null;
  return hasSession(p);
}

/**
 * Link aus der Anmelde-Mail: Er belegt die Adresse. Gehört sie diesem Zugang
 * (bestätigt) und ist schon ein Passwort oder Passkey eingerichtet, meldet der
 * Link an (`setRiderCookie`). Null: ohne Anmeldedaten geht es zum Einrichten.
 * Trägt der Link eine Version (`mailLinkKey`), meldet er nur an, solange sie
 * der `sessionVersion` des Profils entspricht; danach geht es zur Anmeldung.
 */
export async function mailLinkSession(
  token: string,
  email: string,
  version?: number,
): Promise<{ id: number; sessionVersion: number } | null> {
  const p = await prisma.riderProfile.findUnique({
    where: { token },
    select: { id: true, email: true, sessionVersion: true, passwordHash: true, _count: { select: { passkeys: true } } },
  });
  if (!p || p.email !== email || (p.passwordHash == null && p._count.passkeys === 0)) return null;
  if (version !== undefined && version !== p.sessionVersion) return null;
  return { id: p.id, sessionVersion: p.sessionVersion };
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

/**
 * Zähler der Passwort-Sperre für ein Profil und eine Client-IP. Liegt in
 * derselben Tabelle wie die Sperre der Verwaltung (lib/login-lockout), mit
 * eigenem Abdruck je Profil; IP und Profil nur als Abdruck.
 */
export function riderLoginLockKey(profileId: number, ip: string): LoginLockKey {
  return { emailHash: keyedFingerprint("rider-login-profile", String(profileId)), ipHash: loginIpHash(ip) };
}

/** Neues Passwort oder Zugang zurückgesetzt: Sperren dieses Profils an allen IPs aufheben. */
export async function resetRiderLoginLocks(profileId: number): Promise<void> {
  await prisma.adminLoginLock.updateMany({
    where: { emailHash: riderLoginLockKey(profileId, "").emailHash },
    data: { failures: 0, lockedUntil: null },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Passwort prüfen. Gesperrt wird je (Profil, Client-IP) nach den
 * Fehlversuchen aus lib/login-limits für 15 Minuten; wer nur den Link kennt,
 * sperrt so nicht die Person selbst aus. Über alle IPs zusammen wird nur
 * verlangsamt und getaktet, IPs mit früherer richtiger Eingabe nicht.
 * „slow“: gerade kein Takt frei, der Versuch zählt nicht.
 */
export async function checkRiderPassword(
  p: RiderAuthProfile,
  password: unknown,
  ip: string,
  now: Date = new Date(),
): Promise<"ok" | "wrong" | "locked" | "slow"> {
  await pruneLoginLocks(now);
  const key = riderLoginLockKey(p.id, ip);
  const start = Date.now();
  const delay = await loginSlowdownMs(key.emailHash, now);
  // Versuch vor dem Vergleich belegen: gleichzeitige Anfragen unterlaufen die Sperre so nicht.
  if (!(await reserveLoginAttempt(key, now))) return "locked";
  if (delay > 0 && !(await isKnownLoginIp(key, now))) {
    if (!(await waitForLoginPaceSlot(key.emailHash, now))) {
      await releaseLoginAttempt(key);
      return "slow";
    }
  }
  const remaining = delay - (Date.now() - start);
  if (remaining > 0) await sleep(remaining);

  const ok = typeof password === "string" && !!p.passwordHash && (await bcrypt.compare(password, p.passwordHash));
  if (ok) {
    await clearLoginFailures(key, now);
    return "ok";
  }
  await lockLoginIfExhausted(key, now);
  return "wrong";
}

/** Antwort der Schnittstellen auf „locked“ und „slow“ aus `checkRiderPassword`. */
export function riderPasswordLimitResponse(check: "locked" | "slow"): NextResponse {
  return NextResponse.json(
    { error: check === "locked" ? "Zu viele Versuche. Bitte in 15 Minuten noch einmal." : "Gerade sehr viele Versuche. Bitte gleich noch einmal." },
    { status: 429 },
  );
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

/** Name im Passkey-Menü des Handys: Vorname und Nachname der Person, sonst „Deine Saison“. */
export async function riderPasskeyLabel(profileId: number): Promise<string> {
  const p = await prisma.riderProfile.findUnique({ where: { id: profileId }, select: { firstName: true, lastName: true } });
  const name = [p?.firstName, p?.lastName].map((v) => v?.trim()).filter(Boolean).join(" ").slice(0, 60);
  return name || "Deine Saison";
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

// ------------------------------------- Passkey ohne Link (Startseite /app)

const ANY_LOGIN = "rider-login:any";

/** Anmeldung ohne Link: das Handy bietet alle Passkeys für diese Domain an. */
export async function riderAnyLoginOptions(rp: RelyingParty) {
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, timeout: TIMEOUT_MS, userVerification: "required" });
  await storeChallenge(options.challenge, ANY_LOGIN);
  return options;
}

/**
 * Passkey ohne Link prüfen. Der Passkey verrät das Profil; liefert es bei
 * Erfolg (für Cookie und Weiterleitung), sonst null.
 */
export async function riderVerifyAnyLogin(
  rp: RelyingParty,
  response: AuthenticationResponseJSON,
): Promise<{ id: number; token: string; sessionVersion: number } | null> {
  if (!response || typeof response.id !== "string") return null;
  const key = await prisma.riderPasskey.findUnique({
    where: { credentialId: response.id },
    select: { id: true, credentialId: true, publicKey: true, counter: true, transports: true, profile: { select: { token: true } } },
  });
  if (!key) return null;
  const profile = await findRiderAuthProfile(key.profile.token);
  if (!profile) return null;
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => consumeChallenge(challenge, ANY_LOGIN),
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
    return null;
  }
  if (!verified.verified) return null;
  await prisma.riderPasskey.update({
    where: { id: key.id },
    data: {
      counter: verified.authenticationInfo.newCounter,
      backedUp: verified.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date(),
    },
  });
  return { id: profile.id, token: profile.token, sessionVersion: profile.sessionVersion };
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
  await resetRiderLoginLocks(profileId);
  // Die bisherigen Geräte gehören womöglich nicht mehr dem Fahrer.
  await prisma.riderPushSubscription.deleteMany({ where: { profileId, accountId } });
  return token;
}
