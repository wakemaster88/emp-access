/**
 * Ereignisarten, auf die eine Regel „Bewegung“ reagieren kann. Eine Liste
 * fuer beide Eingabepruefungen (validators.ts, Anlegen und Aendern) und beide
 * Regel-Dialoge (Cloud: rule-dialog.tsx, Hub: hub/src/ui/dashboard.html;
 * rule-event-types.test.ts prueft die Optionen des Hub-Dialogs dagegen).
 *
 * Der Hub meldet Klingel-Ereignisse der DoorBird (api/hub/camera-events),
 * die Engine verarbeitet sie wie jede andere Ereignisart.
 */
export const RULE_EVENT_TYPES = ["PERSON", "VEHICLE", "MOTION", "DOORBELL"] as const;

export type RuleEventType = (typeof RULE_EVENT_TYPES)[number];

/** Beschriftung im Dialog. */
export const RULE_EVENT_TYPE_LABELS: Record<RuleEventType, string> = {
  PERSON: "Person",
  VEHICLE: "Fahrzeug",
  MOTION: "Bewegung",
  DOORBELL: "Klingel (DoorBird)",
};
