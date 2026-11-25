/**
 * Befehl SetWhiteLed für das Weißlicht (reine Logik). Dieselbe Regel wie im
 * Hub (hub/src/spotlight-rules.ts): Geschaltet wird nur an und aus.
 * Lichtmodus (mode) und Helligkeit (bright) bleiben, wie die Kamera sie auf
 * GetWhiteLed meldet; eine Helligkeit gilt nur beim Einschalten. Zeitplan
 * und Erkennungsarten stehen nicht im Befehl und bleiben an der Kamera.
 *
 * Ohne brauchbaren Stand und mit WEBCAMS_SPOTLIGHT_LEGACY=1 geht der frühere
 * Befehl hinaus: Lichtmodus 1, Helligkeit 100 oder die angegebene.
 */

export interface WhiteLedParam {
  state: 0 | 1;
  mode: number;
  bright?: number;
}

/** WEBCAMS_SPOTLIGHT_LEGACY: 1, true, ja, on (auch yes) stellt den früheren Befehl her. */
export function spotlightLegacy(env: string | undefined): boolean {
  return /^(1|true|on|yes|ja)$/i.test((env ?? "").trim());
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function explicitBrightness(brightness: number | undefined): number | undefined {
  if (typeof brightness !== "number" || !Number.isFinite(brightness)) return undefined;
  return Math.min(100, Math.max(1, Math.round(brightness)));
}

/**
 * Nur `state` ändert sich; `mode` und `bright` wie gemeldet (bright beim
 * Einschalten mit ausdrücklicher Helligkeit diese). null: kein brauchbarer
 * Stand (state nicht 0/1 oder mode keine ganze Zahl).
 */
export function whiteLedParam(current: unknown, on: boolean, brightness?: number): WhiteLedParam | null {
  if (!isRecord(current)) return null;
  if (!isIntIn(current.state, 0, 1)) return null;
  if (!isIntIn(current.mode, 0, Number.MAX_SAFE_INTEGER)) return null;
  const param: WhiteLedParam = { state: on ? 1 : 0, mode: current.mode };
  const wanted = on ? explicitBrightness(brightness) : undefined;
  if (wanted !== undefined) param.bright = wanted;
  else if (isIntIn(current.bright, 0, 100)) param.bright = current.bright;
  return param;
}

/** Der frühere Befehl: Lichtmodus 1, Helligkeit 100 oder die angegebene. */
export function legacyWhiteLedParam(on: boolean, brightness?: number): WhiteLedParam {
  return { state: on ? 1 : 0, mode: 1, bright: explicitBrightness(brightness) ?? 100 };
}

/** Welcher Befehl an die Kamera geht (`current` = Feld WhiteLed der Antwort, null = nicht lesbar). */
export function spotlightParam(s: {
  legacy: boolean;
  current: unknown;
  on: boolean;
  brightness?: number;
}): WhiteLedParam {
  if (s.legacy) return legacyWhiteLedParam(s.on, s.brightness);
  return whiteLedParam(s.current, s.on, s.brightness) ?? legacyWhiteLedParam(s.on, s.brightness);
}
