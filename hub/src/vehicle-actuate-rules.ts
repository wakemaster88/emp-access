/**
 * Welche DoorBird ein Fahrzeug der Liste öffnet (reine Logik).
 *
 * Das Tor öffnet nur für Fahrzeuge mit zugewiesener DoorBird (Entscheidung
 * vom 25.11.2026). HUB_DOORBIRD_FALLBACK=1 (auch true, ja, on) stellt den
 * früheren Rückfall her: ohne Zuweisung die DoorBird, wenn genau eine
 * eingerichtet ist. Lieferdienst-Öffnung, Aufträge aus der Cloud und
 * Offenhaltung nennen ihre DoorBird selbst und nutzen diese Regel nicht.
 */

/**
 * Läuft die Sperrzeit eines Fahrzeugs nach seiner letzten Schaltung noch?
 * Ein Zeitpunkt mehr als `maxAheadMs` in der Zukunft (Uhr von Hub oder Cloud
 * ging falsch) zählt nicht: Er würde das Fahrzeug sonst sperren, bis die
 * echte Zeit ihn einholt.
 */
export function cooldownActive(lastTriggeredAt: number | null, now: number, cooldownMs: number, maxAheadMs: number): boolean {
  if (!lastTriggeredAt) return false;
  if (lastTriggeredAt - now > maxAheadMs) return false;
  return now - lastTriggeredAt < cooldownMs;
}

/** Früherer Rückfall auf die einzige DoorBird eingeschaltet? */
export function doorbirdFallback(env: string | undefined): boolean {
  return /^(1|true|ja|on)$/i.test((env ?? "").trim());
}

/** DoorBird zum Öffnen: die zugewiesene, mit Rückfall sonst die einzige eingerichtete. */
export function resolveDoorbirdId(
  vehicle: { doorbirdCameraId: number | null },
  doorbirdIds: readonly number[],
  fallback: boolean
): number | null {
  if (vehicle.doorbirdCameraId) return vehicle.doorbirdCameraId;
  if (!fallback) return null;
  return doorbirdIds.length === 1 ? doorbirdIds[0] : null;
}

/**
 * Fehlt dem Listen-Fahrzeug jeder Aktor (Logzeile, Zähler alpr.no_actuator)?
 * Ja, wenn der Hub weder eine DoorBird noch einen Shelly mit IP-Adresse hat
 * und die Cloud auch keinen Shelly ohne IP-Adresse meldet: Einen solchen
 * schaltet die Cloud selbst über die Shelly-Cloud, er fehlt also nicht.
 * `shellyLinked` null = die Cloud liefert die Angabe noch nicht (älterer
 * Stand); dann zählt wie bisher nur, was der Hub selbst schalten kann.
 */
export function lacksActuator(
  vehicle: { shellyIp: string | null; shellyLinked: boolean | null },
  doorId: number | null
): boolean {
  if (doorId != null || vehicle.shellyIp) return false;
  return vehicle.shellyLinked !== true;
}
