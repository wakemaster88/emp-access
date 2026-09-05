import { prisma } from "@/lib/prisma";

/**
 * Sperre nach zu vielen falschen Passwoertern, in der Datenbank statt nur im
 * Prozessspeicher: Auf Vercel laufen viele Instanzen parallel, eine
 * In-Memory-Bremse (login-throttle.ts) greift dort nur pro Instanz. Das
 * Gegenstueck fuer den zweiten Faktor sitzt in two-factor.ts.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MINUTES = 15;

export type LoginLockFields = {
  id: number;
  loginFailures: number;
  loginLockedUntil: Date | null;
};

export function isLoginLocked(admin: Pick<LoginLockFields, "loginLockedUntil">, now = new Date()): boolean {
  return Boolean(admin.loginLockedUntil && admin.loginLockedUntil > now);
}

export function loginRetryAfterSec(admin: Pick<LoginLockFields, "loginLockedUntil">, now = new Date()): number {
  if (!admin.loginLockedUntil) return 0;
  return Math.max(1, Math.ceil((admin.loginLockedUntil.getTime() - now.getTime()) / 1000));
}

/** Fehlversuch zaehlen; ab LOGIN_MAX_FAILURES sperren. */
export async function registerLoginFailure(admin: LoginLockFields, now = new Date()): Promise<void> {
  // Eine abgelaufene Sperre setzt den Zaehler zurueck, sonst wuerde der
  // naechste Fehlversuch sofort wieder sperren.
  const before = admin.loginLockedUntil && admin.loginLockedUntil <= now ? 0 : admin.loginFailures;
  const failures = before + 1;
  const lock = failures >= LOGIN_MAX_FAILURES;
  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      loginFailures: lock ? 0 : failures,
      loginLockedUntil: lock ? new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000) : null,
    },
  });
}

export async function clearLoginFailures(adminId: number): Promise<void> {
  await prisma.admin.update({
    where: { id: adminId },
    data: { loginFailures: 0, loginLockedUntil: null },
  });
}

/**
 * bcrypt-Hash eines Passworts, das niemand kennt. Damit ein unbekanntes Konto
 * nicht spuerbar schneller antwortet als ein bekanntes, laeuft auch dann ein
 * echter Vergleich mit denselben Kosten.
 */
export const DUMMY_PASSWORD_HASH = "$2b$12$tPNA94P44gf5rC3TNFFr/OMt4HF6aef5QS33gm5HpP6V43cURutca";
