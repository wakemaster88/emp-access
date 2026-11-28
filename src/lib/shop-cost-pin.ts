import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { isValidShopCostPin, SHOP_COST_PIN_MAX_LENGTH, SHOP_COST_PIN_MIN_LENGTH } from "@/lib/shop-scan";

/**
 * PIN für EK und Marge im Shop-Monitor (28.11.2026, Aaron: „EK mit PIN am
 * Monitor“). Je Mandant eine PIN aus 4 bis 8 Ziffern, gespeichert nur als
 * bcrypt-Hash in `ShopCostPin`; gesetzt und entfernt nur von Admins unter
 * Einstellungen › Integrationen › EMP-Shop.
 *
 * Der Kiosk schickt die PIN einmal und bekommt dafür eine Freischaltung
 * (`sealSecret`, an Mandant, Monitor und PIN gebunden, `SHOP_COST_UNLOCK_MINUTES`
 * gültig). Mit ihr holt er den Einstand neuer Positionen, ohne die PIN zu
 * behalten. Eine neue oder entfernte PIN beendet alle Freischaltungen.
 *
 * Gegen Durchprobieren: Jeder Versuch wird vor dem Vergleich in der Datenbank
 * reserviert (bedingtes UPDATE wie in login-lockout.ts), nach
 * `SHOP_COST_PIN_MAX_FAILURES` Fehlversuchen ist die PIN für
 * `SHOP_COST_PIN_LOCK_MINUTES` gesperrt, über alle Geräte und Instanzen.
 * Das sind höchstens 480 Versuche am Tag; bei 4 Ziffern (10.000 Möglichkeiten)
 * im Mittel gut 10 Tage Dauerprobieren am Monitor, bei 6 Ziffern Jahre.
 */

export const SHOP_COST_PIN_MAX_FAILURES = 5;
export const SHOP_COST_PIN_LOCK_MINUTES = 15;
export const SHOP_COST_UNLOCK_MINUTES = 30;

const BCRYPT_ROUNDS = 10;
const UNLOCK_KIND = "shop-costs";

type Where = Record<string, unknown>;
type Data = Record<string, unknown>;

interface PinRow {
  pinHash: string;
  pinSetAt: Date;
  lockedUntil: Date | null;
}

/** Ausschnitt des Prisma-Clients, damit die Logik in Tests gegen eine Attrappe läuft. */
export interface ShopCostPinDb {
  shopCostPin: {
    findUnique(args: { where: { accountId: number }; select?: Record<string, boolean> }): Promise<PinRow | null>;
    updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
    upsert(args: { where: { accountId: number }; create: Data & { accountId: number }; update: Data }): Promise<unknown>;
    deleteMany(args: { where: Where }): Promise<{ count: number }>;
  };
}

const defaultDb = prisma as unknown as ShopCostPinDb;

export type ShopCostPinCheck =
  | { ok: true; pinSetAt: Date }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "wrong" }
  | { ok: false; reason: "locked"; lockedUntil: Date };

function lockUntil(now: Date): Date {
  return new Date(now.getTime() + SHOP_COST_PIN_LOCK_MINUTES * 60_000);
}

/** PIN setzen oder ersetzen; Fehlversuche und Sperre entfallen. */
export async function setShopCostPin(accountId: number, pin: string, now = new Date(), db: ShopCostPinDb = defaultDb): Promise<void> {
  if (!isValidShopCostPin(pin)) throw new Error(`Die PIN muss aus ${SHOP_COST_PIN_MIN_LENGTH} bis ${SHOP_COST_PIN_MAX_LENGTH} Ziffern bestehen.`);
  const pinHash = await hash(pin, BCRYPT_ROUNDS);
  const data = { pinHash, pinSetAt: now, failures: 0, lockedUntil: null, lastAttemptAt: null };
  await db.shopCostPin.upsert({ where: { accountId }, create: { accountId, ...data }, update: data });
}

export async function removeShopCostPin(accountId: number, db: ShopCostPinDb = defaultDb): Promise<void> {
  await db.shopCostPin.deleteMany({ where: { accountId } });
}

/**
 * Einen Versuch reservieren. `false` heißt gesperrt: Die PIN wird gar nicht
 * erst verglichen. Von gleichzeitigen Anfragen kommen nur so viele durch, wie
 * bis zur Grenze frei sind; die Bedingung prüft die Datenbank selbst.
 */
async function reserveAttempt(accountId: number, now: Date, db: ShopCostPinDb): Promise<boolean> {
  const reserved = await db.shopCostPin.updateMany({
    where: { accountId, lockedUntil: null, failures: { lt: SHOP_COST_PIN_MAX_FAILURES } },
    data: { failures: { increment: 1 }, lastAttemptAt: now },
  });
  if (reserved.count > 0) return true;
  // Abgelaufene Sperre: Zähler neu, der erste Versuch ist belegt.
  const reopened = await db.shopCostPin.updateMany({
    where: { accountId, lockedUntil: { lte: now } },
    data: { failures: 1, lockedUntil: null, lastAttemptAt: now },
  });
  if (reopened.count > 0) return true;
  await lockIfExhausted(accountId, now, db);
  return false;
}

async function lockIfExhausted(accountId: number, now: Date, db: ShopCostPinDb): Promise<void> {
  await db.shopCostPin.updateMany({
    where: { accountId, lockedUntil: null, failures: { gte: SHOP_COST_PIN_MAX_FAILURES } },
    data: { lockedUntil: lockUntil(now), lastAttemptAt: now },
  });
}

/** PIN prüfen, mit Sperre nach zu vielen Fehlversuchen. */
export async function checkShopCostPin(
  accountId: number,
  pin: string,
  now = new Date(),
  db: ShopCostPinDb = defaultDb,
): Promise<ShopCostPinCheck> {
  const select = { pinHash: true, pinSetAt: true, lockedUntil: true };
  const row = await db.shopCostPin.findUnique({ where: { accountId }, select });
  if (!row) return { ok: false, reason: "missing" };
  if (!(await reserveAttempt(accountId, now, db))) {
    const locked = await db.shopCostPin.findUnique({ where: { accountId }, select });
    if (!locked) return { ok: false, reason: "missing" };
    return { ok: false, reason: "locked", lockedUntil: locked.lockedUntil ?? lockUntil(now) };
  }
  const ok = isValidShopCostPin(pin) && (await compare(pin, row.pinHash));
  if (ok) {
    // Eine bestehende Sperre bleibt (Bedingung lockedUntil: null).
    await db.shopCostPin.updateMany({ where: { accountId, lockedUntil: null }, data: { failures: 0 } });
    return { ok: true, pinSetAt: row.pinSetAt };
  }
  await lockIfExhausted(accountId, now, db);
  const after = await db.shopCostPin.findUnique({ where: { accountId }, select });
  if (after?.lockedUntil && after.lockedUntil > now) return { ok: false, reason: "locked", lockedUntil: after.lockedUntil };
  return { ok: false, reason: "wrong" };
}

/** Freischaltung nach richtiger PIN: verschlüsselt, an Mandant, Monitor und PIN gebunden. */
export function issueShopCostUnlock(
  accountId: number,
  monitorId: number,
  pinSetAt: Date,
  now = new Date(),
): { unlock: string; expiresAt: string } {
  const expiresAt = new Date(now.getTime() + SHOP_COST_UNLOCK_MINUTES * 60_000);
  const unlock = sealSecret(
    JSON.stringify({ k: UNLOCK_KIND, a: accountId, m: monitorId, p: pinSetAt.getTime(), e: expiresAt.getTime() }),
  );
  return { unlock, expiresAt: expiresAt.toISOString() };
}

/** Gilt die Freischaltung noch (richtiger Mandant und Monitor, dieselbe PIN, nicht abgelaufen)? */
export function shopCostUnlockValid(
  unlock: string,
  accountId: number,
  monitorId: number,
  pinSetAt: Date,
  now = new Date(),
): boolean {
  const plain = openSecret(unlock);
  if (!plain) return false;
  try {
    const d = JSON.parse(plain) as { k?: unknown; a?: unknown; m?: unknown; p?: unknown; e?: unknown };
    return (
      d.k === UNLOCK_KIND &&
      d.a === accountId &&
      d.m === monitorId &&
      d.p === pinSetAt.getTime() &&
      typeof d.e === "number" &&
      d.e > now.getTime()
    );
  } catch {
    return false;
  }
}

/** Ist für den Mandanten eine PIN gesetzt? Für Einstellungen und Kiosk. */
export async function shopCostPinRow(accountId: number, db: ShopCostPinDb = defaultDb): Promise<PinRow | null> {
  return db.shopCostPin.findUnique({ where: { accountId }, select: { pinHash: true, pinSetAt: true, lockedUntil: true } });
}
