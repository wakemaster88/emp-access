/**
 * Grenzen der Passwort-Sperre ohne Abhaengigkeit von der Datenbank, damit
 * auch die Anmeldeseite im Browser sie nennen kann. Die Sperre selbst sitzt
 * in login-lockout.ts.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MINUTES = 15;

/**
 * Fehlertext der Anmeldeseite fuer jede gescheiterte Passwort-Anmeldung.
 * Er ist fuer falsches Passwort, unbekannte E-Mail und gesperrten Anschluss
 * gleich – haengt also nicht davon ab, ob gerade eine Sperre greift – und
 * erklaert trotzdem, was nach vielen Fehlversuchen passiert. Den Passkey
 * nennt er nur, wenn die Seite die Passkey-Anmeldung anbietet.
 */
export function loginFailedMessage(passkeyOffered: boolean): string {
  const base =
    `Ungültige Anmeldedaten. Nach ${LOGIN_MAX_FAILURES} Fehlversuchen ist die Anmeldung von diesem ` +
    `Anschluss für ${LOGIN_LOCK_MINUTES} Minuten gesperrt`;
  return passkeyOffered ? `${base} – die Anmeldung per Passkey geht weiter.` : `${base}.`;
}
