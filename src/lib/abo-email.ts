/**
 * Jedes Abo hängt an einer E-Mail-Adresse (Aaron, 20.11.2026). Über sie
 * findet der Kunde sein Abo in der App, und sie trägt die Hinweise zum
 * Ablauf. Neue Abos brauchen deshalb eine Adresse, und bei einem Abo lässt
 * sie sich ändern, aber nicht mehr entfernen.
 *
 * Abos aus der Zeit davor ohne Adresse (Reepay-Import, manuell) bleiben
 * bearbeitbar; sie stehen unter Abos in der Liste „Abos ohne E-Mail“.
 * anny-Abos bringen die Adresse des anny-Kontos immer mit.
 */

export const ABO_EMAIL_REQUIRED =
  "Für ein Abo ist eine E-Mail-Adresse nötig. Darüber findet der Kunde sein Abo in der App.";
export const ABO_EMAIL_KEEP =
  "Bei einem Abo lässt sich die E-Mail-Adresse ändern, aber nicht entfernen.";

/** Adresse für die Datenbank: ohne Leerraum, klein geschrieben; leer wird null. */
export function cleanEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

interface AboEmailState {
  subscriptionId: number | null | undefined;
  email: string | null | undefined;
}

/**
 * Fehlertext, wenn ein Abo ohne Adresse gespeichert würde, sonst null.
 * `before` ist der Stand vor dem Speichern (null beim Anlegen).
 */
export function aboEmailError(before: AboEmailState | null, after: AboEmailState): string | null {
  if (after.subscriptionId == null) return null;
  if (cleanEmail(after.email)) return null;
  if (!before || before.subscriptionId == null) return ABO_EMAIL_REQUIRED;
  if (cleanEmail(before.email)) return ABO_EMAIL_KEEP;
  return null;
}
