import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "./prisma";
import { webauthnUserId, type RelyingParty } from "./passkey-utils";

/**
 * Passkeys (WebAuthn) als zusaetzliche Anmeldung neben E-Mail und Passwort.
 *
 * Ein Passkey ersetzt Passwort und zweiten Faktor zugleich: Er ist an die
 * Domain gebunden (kein Phishing), liegt im Geraet und wird dort per Face ID,
 * Fingerabdruck oder Geraete-PIN freigegeben (Nutzerverifikation ist Pflicht).
 *
 * Die Challenges liegen in der Datenbank und gelten genau einmal, damit eine
 * abgefangene Antwort nicht ein zweites Mal eingeloest werden kann – auch wenn
 * der Zaehler des Authenticators (bei synchronisierten Passkeys meist 0) dabei
 * nicht hilft.
 */

export const RP_NAME = "EMP Access";
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const MAX_PASSKEYS_PER_ADMIN = 10;
const TIMEOUT_MS = 120_000;

/** Felder fuer die Liste in den Einstellungen (ohne Schluesselmaterial). */
export const passkeyListSelect = {
  id: true,
  name: true,
  deviceType: true,
  backedUp: true,
  createdAt: true,
  lastUsedAt: true,
} as const;

export type ChallengePurpose = "login" | "register";

export { cleanPasskeyName, relyingPartyFrom, suggestPasskeyName, webauthnUserId } from "./passkey-utils";
export type { RelyingParty } from "./passkey-utils";

async function storeChallenge(challenge: string, purpose: ChallengePurpose, adminId: number | null) {
  const now = new Date();
  // Abgelaufene Challenges nebenbei aufraeumen; die Tabelle bleibt so klein.
  await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.passkeyChallenge.create({
    data: { challenge, purpose, adminId, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) },
  });
}

/**
 * Loest eine Challenge ein: true nur, wenn sie existiert, zum Zweck (und bei
 * der Registrierung zum Admin) passt und nicht abgelaufen ist. Das Loeschen
 * ist atomar, ein zweiter Aufruf mit derselben Challenge scheitert.
 */
export async function consumeChallenge(
  challenge: string,
  purpose: ChallengePurpose,
  adminId: number | null = null,
): Promise<boolean> {
  const { count } = await prisma.passkeyChallenge.deleteMany({
    where: {
      challenge,
      purpose,
      ...(purpose === "register" ? { adminId } : {}),
      expiresAt: { gt: new Date() },
    },
  });
  return count === 1;
}

export async function createRegistrationOptions(
  rp: RelyingParty,
  admin: { id: number; email: string; name: string },
) {
  const existing = await prisma.passkey.findMany({
    where: { adminId: admin.id },
    select: { credentialId: true, transports: true },
  });
  if (existing.length >= MAX_PASSKEYS_PER_ADMIN) return null;
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: admin.email,
    userDisplayName: admin.name || admin.email,
    userID: webauthnUserId(admin.id),
    timeout: TIMEOUT_MS,
    attestationType: "none",
    // Ein Geraet nicht zweimal fuer dasselbe Konto anmelden.
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await storeChallenge(options.challenge, "register", admin.id);
  return options;
}

export async function verifyRegistration(
  rp: RelyingParty,
  adminId: number,
  response: RegistrationResponseJSON,
) {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: (challenge) => consumeChallenge(challenge, "register", adminId),
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  });
  if (!result.verified) return null;
  const info = result.registrationInfo;
  return {
    credentialId: info.credential.id,
    publicKey: new Uint8Array(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
  };
}

export async function createLoginOptions(rp: RelyingParty) {
  // Ohne allowCredentials: der Browser bietet alle Passkeys fuer die Domain an,
  // die E-Mail muss vorher nicht eingegeben werden.
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    timeout: TIMEOUT_MS,
    userVerification: "required",
    challenge: randomBytes(32),
  });
  await storeChallenge(options.challenge, "login", null);
  return options;
}

/**
 * Prueft eine Passkey-Anmeldung und liefert den Admin oder null. Wird
 * ausschliesslich aus authorize() (src/lib/auth.ts) aufgerufen.
 */
export async function verifyPasskeyLogin(rp: RelyingParty, raw: unknown) {
  let response: AuthenticationResponseJSON;
  try {
    response = (typeof raw === "string" ? JSON.parse(raw) : raw) as AuthenticationResponseJSON;
  } catch {
    return null;
  }
  if (!response || typeof response.id !== "string" || typeof response.response !== "object") return null;

  const passkey = await prisma.passkey.findUnique({
    where: { credentialId: response.id },
    include: { admin: { include: { account: true } } },
  });
  if (!passkey) return null;

  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => consumeChallenge(challenge, "login"),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
  } catch {
    return null;
  }
  if (!verified.verified) return null;

  const admin = passkey.admin;
  if (admin.accountId != null && admin.account && !admin.account.isActive) return null;

  const now = new Date();
  await prisma.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: verified.authenticationInfo.newCounter,
      backedUp: verified.authenticationInfo.credentialBackedUp,
      lastUsedAt: now,
    },
  });
  await prisma.admin.update({
    where: { id: admin.id },
    data: { lastLogin: now, loginFailures: 0, loginLockedUntil: null },
  });
  return admin;
}
