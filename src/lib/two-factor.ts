import { timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { keyedFingerprint, openSecret, sealSecret } from "./secret-box";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  normalizeTotpCode,
  otpauthUrl,
  verifyTotp,
} from "./totp";

/**
 * Zweiter Faktor fuer den Admin-Login: TOTP aus einer Authenticator-App,
 * ersatzweise ein einmalig nutzbarer Wiederherstellungscode.
 *
 * Da ein TOTP nur sechs Stellen hat (eine Million Moeglichkeiten, Fenster von
 * drei Zeitschritten), ist eine Bremse gegen Raten Pflicht: nach
 * MAX_FAILURES Fehlversuchen ist das Konto fuer LOCK_MINUTES gesperrt.
 */

export const ISSUER = "EMP Access";
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const RECOVERY_NAMESPACE = "admin-recovery-code";

export interface TwoFactorFields {
  id: number;
  twoFactorSecret: string | null;
  twoFactorEnabledAt: Date | null;
  twoFactorRecoveryCodes: string[];
  twoFactorLastStep: number | null;
  twoFactorFailures: number;
  twoFactorLockedUntil: Date | null;
}

/** Felder, die fuer die Pruefung geladen werden muessen (Prisma-select). */
export const twoFactorSelect = {
  id: true,
  twoFactorSecret: true,
  twoFactorEnabledAt: true,
  twoFactorRecoveryCodes: true,
  twoFactorLastStep: true,
  twoFactorFailures: true,
  twoFactorLockedUntil: true,
} as const;

/**
 * Minimalschnittstelle auf den Prisma-Client, damit die Logik in Tests gegen
 * eine Attrappe laufen kann.
 */
export interface TwoFactorDb {
  admin: {
    update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export type TwoFactorFailure = "missing" | "invalid" | "locked" | "unreadable";

export type TwoFactorResult =
  | { ok: true; usedRecoveryCode: boolean; recoveryCodesLeft: number }
  | { ok: false; reason: TwoFactorFailure; retryAfterSec?: number };

export function isTwoFactorActive(admin: Pick<TwoFactorFields, "twoFactorSecret" | "twoFactorEnabledAt">): boolean {
  return Boolean(admin.twoFactorEnabledAt && admin.twoFactorSecret);
}

export function isTwoFactorLocked(admin: Pick<TwoFactorFields, "twoFactorLockedUntil">, now: Date = new Date()): boolean {
  return Boolean(admin.twoFactorLockedUntil && admin.twoFactorLockedUntil > now);
}

function fingerprint(code: string): string {
  return keyedFingerprint(RECOVERY_NAMESPACE, normalizeRecoveryCode(code));
}

function fingerprintMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Prueft den eingegebenen zweiten Faktor und schreibt das Ergebnis direkt fort
 * (Fehlversuche, Sperre, verbrauchter Wiederherstellungscode, Replay-Schutz).
 */
export async function verifySecondFactor(
  admin: TwoFactorFields,
  input: string | null | undefined,
  options: { db?: TwoFactorDb; now?: Date } = {}
): Promise<TwoFactorResult> {
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();

  if (isTwoFactorLocked(admin, now)) {
    const retryAfterSec = Math.ceil((admin.twoFactorLockedUntil!.getTime() - now.getTime()) / 1000);
    return { ok: false, reason: "locked", retryAfterSec };
  }

  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "missing" };

  const secret = openSecret(admin.twoFactorSecret);
  if (!secret) return { ok: false, reason: "unreadable" };

  // Eine abgelaufene Sperre setzt den Zaehler zurueck, sonst wuerde der
  // naechste Fehlversuch sofort wieder sperren.
  const failuresBefore =
    admin.twoFactorLockedUntil && admin.twoFactorLockedUntil <= now ? 0 : admin.twoFactorFailures;

  if (looksLikeRecoveryCode(raw)) {
    const candidate = fingerprint(raw);
    const remaining = admin.twoFactorRecoveryCodes.filter((stored) => !fingerprintMatches(stored, candidate));
    if (remaining.length !== admin.twoFactorRecoveryCodes.length) {
      await db.admin.update({
        where: { id: admin.id },
        data: {
          twoFactorRecoveryCodes: remaining,
          twoFactorFailures: 0,
          twoFactorLockedUntil: null,
        },
      });
      return { ok: true, usedRecoveryCode: true, recoveryCodesLeft: remaining.length };
    }
    return registerFailure(db, admin, failuresBefore, now);
  }

  if (normalizeTotpCode(raw).length !== 6) {
    return registerFailure(db, admin, failuresBefore, now);
  }

  const step = verifyTotp(secret, raw, { atMs: now.getTime() });
  // Ein bereits verwendeter Zeitschritt zaehlt als Fehlversuch: derselbe Code
  // darf innerhalb seiner 30 Sekunden nicht ein zweites Mal gelten.
  if (step === null || (admin.twoFactorLastStep !== null && step <= admin.twoFactorLastStep)) {
    return registerFailure(db, admin, failuresBefore, now);
  }

  await db.admin.update({
    where: { id: admin.id },
    data: {
      twoFactorLastStep: step,
      twoFactorFailures: 0,
      twoFactorLockedUntil: null,
    },
  });
  return { ok: true, usedRecoveryCode: false, recoveryCodesLeft: admin.twoFactorRecoveryCodes.length };
}

async function registerFailure(
  db: TwoFactorDb,
  admin: TwoFactorFields,
  failuresBefore: number,
  now: Date
): Promise<TwoFactorResult> {
  const failures = failuresBefore + 1;
  const lock = failures >= MAX_FAILURES;
  const lockedUntil = lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null;

  await db.admin.update({
    where: { id: admin.id },
    data: {
      twoFactorFailures: failures,
      twoFactorLockedUntil: lockedUntil,
    },
  });

  if (lock) {
    return { ok: false, reason: "locked", retryAfterSec: LOCK_MINUTES * 60 };
  }
  return { ok: false, reason: "invalid" };
}

/**
 * Legt ein neues, noch nicht scharfes Secret an. Erst die Bestaetigung mit
 * einem gueltigen Code (activateTwoFactor) schaltet den zweiten Faktor ein.
 */
export async function startTwoFactorSetup(adminId: number, email: string) {
  const secret = generateTotpSecret();
  await prisma.admin.update({
    where: { id: adminId },
    data: {
      twoFactorSecret: sealSecret(secret),
      twoFactorEnabledAt: null,
      twoFactorRecoveryCodes: [],
      twoFactorLastStep: null,
      twoFactorFailures: 0,
      twoFactorLockedUntil: null,
    },
  });
  return { secret, url: otpauthUrl({ secret, account: email, issuer: ISSUER }) };
}

export async function activateTwoFactor(
  admin: TwoFactorFields,
  code: string
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; reason: TwoFactorFailure }> {
  const secret = openSecret(admin.twoFactorSecret);
  if (!secret) return { ok: false, reason: "unreadable" };

  const trimmed = code.trim();
  if (!trimmed) return { ok: false, reason: "missing" };

  const step = verifyTotp(secret, trimmed);
  if (step === null) return { ok: false, reason: "invalid" };

  const recoveryCodes = generateRecoveryCodes();
  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      twoFactorEnabledAt: new Date(),
      twoFactorRecoveryCodes: recoveryCodes.map(fingerprint),
      twoFactorLastStep: step,
      twoFactorFailures: 0,
      twoFactorLockedUntil: null,
    },
  });
  return { ok: true, recoveryCodes };
}

export async function replaceRecoveryCodes(adminId: number): Promise<string[]> {
  const recoveryCodes = generateRecoveryCodes();
  await prisma.admin.update({
    where: { id: adminId },
    data: { twoFactorRecoveryCodes: recoveryCodes.map(fingerprint) },
  });
  return recoveryCodes;
}

/** Entfernt Secret, Codes und Sperre – danach greift wieder reines Passwort. */
export async function disableTwoFactor(adminId: number, db: TwoFactorDb = prisma): Promise<void> {
  await db.admin.update({
    where: { id: adminId },
    data: {
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorRecoveryCodes: [],
      twoFactorLastStep: null,
      twoFactorFailures: 0,
      twoFactorLockedUntil: null,
    },
  });
}
