/**
 * Begriffe rund um ein LOQED-Schloss.
 *
 * Getrennt vom HTTP-Client in `src/lib/loqed.ts`, damit Oberflaechen die
 * Beschriftungen importieren koennen, ohne den Netzwerkcode mitzuziehen –
 * dasselbe Muster wie `cover-constants.ts` neben `shelly-cover.ts`.
 *
 * Die drei Riegelzustaende sind nicht "auf" und "zu", sondern:
 *   - `open`       Riegel gezogen, die Tuer geht auf. Das Schloss faellt danach
 *                  selbst in die Tagverriegelung zurueck.
 *   - `day_lock`   Tuer zu, aber nicht abgeschlossen (Falle). Von innen jederzeit
 *                  per Klinke zu oeffnen.
 *   - `night_lock` abgeschlossen.
 */

export type LoqedBoltState = "open" | "day_lock" | "night_lock";

/// Zustand, den das Schloss meldet – kann zusaetzlich unbekannt sein, etwa
/// solange der Riegel nach einem Motorfehler nicht eindeutig steht.
export type LoqedBoltReading = LoqedBoltState | "unknown";

const BOLT_STATE_LABELS: Record<LoqedBoltReading, string> = {
  open: "offen",
  day_lock: "zu (Tagverriegelung)",
  night_lock: "abgeschlossen",
  unknown: "unbekannt",
};

/** Zustand des Riegels als Text – fuer Plaketten und Statuszeilen. */
export function loqedBoltStateLabel(state: string | null | undefined): string {
  if (!state) return BOLT_STATE_LABELS.unknown;
  return BOLT_STATE_LABELS[state as LoqedBoltReading] ?? state;
}

/**
 * Ein offener Riegel ist der Zustand, der Aufmerksamkeit braucht: Die Tuer
 * steht dann frei. `unknown` zaehlt ebenfalls dazu, weil ungewiss ist, ob
 * abgeschlossen wurde.
 */
export function loqedBoltNeedsAttention(state: string | null | undefined): boolean {
  return state === "open" || state === "unknown" || !state;
}

/**
 * Batterieart, die die Integrations-API als Zahl meldet. Der Statusabruf der
 * aelteren Webhook-API benutzt diese Zahlen, die Integrations-API denselben
 * Wert als Text – deshalb beides.
 */
const BATTERY_TYPES: Record<number, string> = {
  0: "alkaline",
  1: "nimh",
  2: "lithium",
  3: "unbekannt",
};

export function loqedBatteryType(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return BATTERY_TYPES[value] ?? null;
  return null;
}
