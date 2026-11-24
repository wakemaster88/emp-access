import { prisma } from "@/lib/prisma";

/**
 * Sperre nach zu vielen falschen Passwoertern, in der Datenbank statt nur im
 * Prozessspeicher: Auf Vercel laufen viele Instanzen parallel, eine
 * In-Memory-Bremse (login-throttle.ts) greift dort nur pro Instanz. Das
 * Gegenstueck fuer den zweiten Faktor sitzt in two-factor.ts.
 *
 * Jeder Versuch wird VOR dem Passwortvergleich in der Datenbank reserviert
 * (ein bedingtes UPDATE mit `increment`). Frueher wurde erst gelesen, dann
 * verglichen und danach ein absoluter Zaehlerstand geschrieben: viele
 * gleichzeitige Anfragen sahen denselben Stand und zaehlten zusammen als ein
 * Fehlversuch – die Sperre liess sich so umgehen.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MINUTES = 15;

export type LoginLockFields = {
  id: number;
  loginFailures: number;
  loginLockedUntil: Date | null;
};

type UpdateManyArgs = { where: Record<string, unknown>; data: Record<string, unknown> };

/**
 * Minimalschnittstelle auf den Prisma-Client, damit die Logik in Tests gegen
 * eine Attrappe laufen kann.
 */
export interface LoginLockDb {
  admin: { updateMany(args: UpdateManyArgs): Promise<{ count: number }> };
}

export function isLoginLocked(admin: Pick<LoginLockFields, "loginLockedUntil">, now = new Date()): boolean {
  return Boolean(admin.loginLockedUntil && admin.loginLockedUntil > now);
}

export function loginRetryAfterSec(admin: Pick<LoginLockFields, "loginLockedUntil">, now = new Date()): number {
  if (!admin.loginLockedUntil) return 0;
  return Math.max(1, Math.ceil((admin.loginLockedUntil.getTime() - now.getTime()) / 1000));
}

function lockUntil(now: Date): Date {
  return new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000);
}

/**
 * Reserviert einen Passwort-Versuch. `false` heisst: gesperrt, das Passwort
 * wird gar nicht erst verglichen.
 *
 * Von N gleichzeitigen Anfragen kommen hoechstens so viele durch, wie bis
 * LOGIN_MAX_FAILURES noch frei sind – die Bedingung prueft die Datenbank
 * selbst, nicht ein zuvor gelesener Stand.
 */
export async function reserveLoginAttempt(
  admin: Pick<LoginLockFields, "id" | "loginLockedUntil">,
  now = new Date(),
  db: LoginLockDb = prisma,
): Promise<boolean> {
  // Eine abgelaufene Sperre setzt den Zaehler zurueck, sonst wuerde der
  // naechste Fehlversuch sofort wieder sperren.
  if (admin.loginLockedUntil && admin.loginLockedUntil <= now) {
    await db.admin.updateMany({
      where: { id: admin.id, loginLockedUntil: { lte: now } },
      data: { loginFailures: 0, loginLockedUntil: null },
    });
  }

  const reserved = await db.admin.updateMany({
    where: { id: admin.id, loginLockedUntil: null, loginFailures: { lt: LOGIN_MAX_FAILURES } },
    data: { loginFailures: { increment: 1 } },
  });
  if (reserved.count > 0) return true;

  // Zaehler voll, aber (noch) keine Sperrzeit – etwa weil die Anfrage, die
  // den letzten Versuch belegt hat, vor dem Sperren abgebrochen ist. Sperrzeit
  // nachtragen, damit das Konto nicht dauerhaft haengen bleibt.
  await lockLoginIfExhausted(admin.id, now, db);
  return false;
}

/** Nach einem falschen Passwort: sperren, sobald der Zaehler voll ist. */
export async function lockLoginIfExhausted(adminId: number, now = new Date(), db: LoginLockDb = prisma): Promise<void> {
  await db.admin.updateMany({
    where: { id: adminId, loginLockedUntil: null, loginFailures: { gte: LOGIN_MAX_FAILURES } },
    data: { loginLockedUntil: lockUntil(now) },
  });
}

/**
 * Nach einem richtigen Passwort: Zaehler zuruecksetzen. Eine bestehende
 * Sperre bleibt unangetastet (Bedingung `loginLockedUntil: null`), damit eine
 * spaet eintreffende Anfrage sie nicht wieder aufhebt.
 */
export async function clearLoginFailures(adminId: number, db: LoginLockDb = prisma): Promise<void> {
  await db.admin.updateMany({
    where: { id: adminId, loginLockedUntil: null },
    data: { loginFailures: 0 },
  });
}

/**
 * bcrypt-Hash eines Passworts, das niemand kennt. Damit ein unbekanntes Konto
 * nicht spuerbar schneller antwortet als ein bekanntes, laeuft auch dann ein
 * echter Vergleich mit denselben Kosten.
 */
export const DUMMY_PASSWORD_HASH = "$2b$12$tPNA94P44gf5rC3TNFFr/OMt4HF6aef5QS33gm5HpP6V43cURutca";
