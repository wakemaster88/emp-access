/**
 * Wofuer ein Betriebszeiten-Profil steht: Lift, Shop oder Strandbad.
 *
 * Kunden-App (Auslastung, Kalender, Skills), Check-in-Monitor und Beach Pass
 * brauchen „die“ Betriebszeit ihres Bereichs. Bisher wurde sie am Namen
 * erraten („Wasserski“, „Shop“). Ein umbenanntes Profil hat dann still die
 * Vorbelegung bekommen. Mit der Verwendung am Profil ist es eindeutig; der
 * Name bleibt der Rueckfall fuer Profile ohne Verwendung.
 *
 * Reine Logik ohne Datenbank, damit Seiten, Routen und Tests sie teilen.
 */

export type OperatingRoleKind = "LIFT" | "SHOP" | "BEACH";

export const OPERATING_ROLES: readonly OperatingRoleKind[] = ["LIFT", "SHOP", "BEACH"];

export const OPERATING_ROLE_LABELS: Record<OperatingRoleKind, string> = {
  LIFT: "Lift (Kunden-App, Auslastung, Skills)",
  SHOP: "Shop (Check-in-Monitor)",
  BEACH: "Strandbad (Beach Pass)",
};

export function isOperatingRole(v: unknown): v is OperatingRoleKind {
  return typeof v === "string" && (OPERATING_ROLES as readonly string[]).includes(v);
}

interface Pickable {
  name: string;
  isDefault: boolean;
  role?: string | null;
}

const LIFT_NAME = /wasserski|wakeboard|seilbahn|lift/i;
const SHOP_NAME = /shop/i;
const BEACH_NAME = /strandbad|beach|strand/i;

function byRole<T extends Pickable>(schedules: T[], role: OperatingRoleKind): T | undefined {
  return schedules.find((s) => s.role === role);
}

/** Welches Profil gilt für den Lift? Verwendung, dann Name, dann Vorbelegung, dann das einzige. */
export function pickLiftSchedule<T extends Pickable>(schedules: T[]): T | null {
  return (
    byRole(schedules, "LIFT") ??
    schedules.find((s) => LIFT_NAME.test(s.name)) ??
    schedules.find((s) => s.isDefault) ??
    (schedules.length === 1 ? schedules[0] : null)
  );
}

/** Welches Profil gilt für den Shop? Erst Shop, dann Lift (je Verwendung vor Name), dann Vorbelegung. */
export function pickShopSchedule<T extends Pickable>(schedules: T[]): T | null {
  return (
    byRole(schedules, "SHOP") ??
    schedules.find((s) => SHOP_NAME.test(s.name)) ??
    byRole(schedules, "LIFT") ??
    schedules.find((s) => LIFT_NAME.test(s.name)) ??
    schedules.find((s) => s.isDefault) ??
    (schedules.length === 1 ? schedules[0] : null)
  );
}

/**
 * Welches Profil gilt für das Strandbad? Verwendung, dann Name. Kein Rückfall
 * auf die Vorbelegung: das ist meist der Lift, und der Beach Pass zeigte sonst
 * dessen Zeiten.
 */
export function pickBeachSchedule<T extends Pickable>(schedules: T[]): T | null {
  return byRole(schedules, "BEACH") ?? schedules.find((s) => BEACH_NAME.test(s.name)) ?? null;
}
