/**
 * Client-sichere Konstanten und Auswertungen fuer Taster (Kategorie TASTER):
 * Relais, die auf Knopfdruck fuer eine feste Dauer einschalten und danach von
 * selbst wieder abfallen – Aussendusche, Wasserhahn, Torimpuls.
 *
 * Die Dauer geht als geraeteeigener Auto-Off-Timer an den Shelly. Das ist der
 * entscheidende Unterschied zu einem Timer im Server: Das Relais faellt auch
 * dann wieder ab, wenn die Verbindung unmittelbar nach dem Einschalten
 * abreisst oder die Funktion zwischendurch beendet wird.
 */

/** Impulsdauer, wenn am Geraet nichts hinterlegt ist. */
export const DEFAULT_PULSE_SECONDS = 30;

/** Obergrenze fuer die konfigurierbare Impulsdauer (30 Minuten). */
export const MAX_PULSE_SECONDS = 1800;

export function isPulseCategory(category: string | null | undefined): boolean {
  return category === "TASTER";
}

/**
 * Taster im Sinne dieser Steuerung: Shelly mit passender Kategorie. Nur der
 * Shelly kennt den Auto-Off-Timer; ein Raspberry Pi schaltet seinen Impuls
 * selbst und kennt dafuer nur die Dauer aus seiner eigenen Konfiguration.
 */
export function isPulseDevice(device: { type: string; category: string | null }): boolean {
  return device.type === "SHELLY" && isPulseCategory(device.category);
}

/**
 * Impulsdauer eines Tasters in Sekunden. Faellt auf den Standardwert zurueck,
 * wenn nichts oder etwas Unbrauchbares hinterlegt ist – ein Taster ohne Dauer
 * bliebe sonst dauerhaft eingeschaltet.
 */
export function pulseSeconds(configured: number | null | undefined): number {
  if (configured == null) return DEFAULT_PULSE_SECONDS;
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_PULSE_SECONDS;
  return Math.min(Math.round(configured), MAX_PULSE_SECONDS);
}

export type PulseParseResult =
  | { ok: true; value: { pulseSeconds: number | null } }
  | { ok: false; error: string };

/**
 * Impulsdauer aus einem Request-Body lesen und pruefen. Fuer Geraete, die kein
 * Taster (mehr) sind, wird die Spalte geleert – sonst bliebe bei einem
 * Funktionswechsel eine Dauer stehen, die niemand mehr sieht.
 */
export function parsePulseInput(
  body: Record<string, unknown>,
  isPulse: boolean,
  current: number | null = null,
): PulseParseResult {
  if (!isPulse) return { ok: true, value: { pulseSeconds: null } };

  const raw = body.pulseSeconds;
  const seconds = raw === undefined ? (current ?? DEFAULT_PULSE_SECONDS) : Number(raw);

  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_PULSE_SECONDS) {
    return {
      ok: false,
      error: `Die Einschaltdauer muss zwischen 1 und ${MAX_PULSE_SECONDS} Sekunden liegen`,
    };
  }

  return { ok: true, value: { pulseSeconds: Math.round(seconds) } };
}

/** Dauer lesbar machen: "45 Sekunden", "3 Minuten", "2 Min. 30 Sek.". */
export function formatPulseDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} Sekunden`;
  const min = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (rest === 0) return min === 1 ? "1 Minute" : `${min} Minuten`;
  return `${min} Min. ${rest} Sek.`;
}
