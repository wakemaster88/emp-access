/**
 * Regeln fuer neu gesetzte Passwoerter der Verwaltung. Bewusst ohne
 * Zeichenklassen-Zwang: Laenge schlaegt Sonderzeichen, ein Passwort-Manager
 * oder ein Satz aus mehreren Woertern erfuellt das von selbst.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** Verbreitete Passwoerter, die die Mindestlaenge erreichen. Kleingeschrieben. */
const COMMON = new Set([
  "123456789012",
  "1234567890123",
  "12345678901234",
  "passwort1234",
  "passwort12345",
  "password1234",
  "password12345",
  "qwertzuiop123",
  "qwertyuiop123",
  "administrator",
  "administrator1",
  "administrator123",
  "admin1234567",
  "admin12345678",
  "admin123admin123",
  "adminadminadmin",
  "hallohallohallo",
  "iloveyou1234",
  "willkommen123",
  "willkommen1234",
]);

/**
 * Deutsche Fehlermeldung, wenn das Passwort nicht taugt – sonst null.
 * `email` verhindert, dass jemand schlicht seine Adresse nimmt.
 */
export function passwordProblem(
  password: unknown,
  context: { email?: string | null } = {},
): string | null {
  if (typeof password !== "string" || password.length === 0) return "Bitte ein neues Passwort eingeben";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Das neue Passwort braucht mindestens ${PASSWORD_MIN_LENGTH} Zeichen`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Das neue Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen haben`;
  }

  const lower = password.toLowerCase();
  if (new Set(lower).size < 5) return "Das neue Passwort ist zu einfach (zu wenige verschiedene Zeichen)";
  if (COMMON.has(lower)) return "Dieses Passwort ist zu verbreitet. Bitte ein anderes wählen";

  const email = context.email?.trim().toLowerCase();
  if (email) {
    const local = email.split("@")[0] ?? "";
    if (lower === email || (local.length >= 4 && lower.includes(local))) {
      return "Das neue Passwort darf die eigene E-Mail-Adresse nicht enthalten";
    }
  }
  return null;
}
