/**
 * Weißlicht einer Reolink-Kamera schalten (reine Logik, testbar).
 *
 * Der Hub schaltet das Weißlicht nur an und aus (Entscheidung vom
 * 25.11.2026): Lichtmodus (mode) und Helligkeit (bright) bleiben, wie die
 * Kamera sie meldet. Darum liest er vor dem Schalten GetWhiteLed und schickt
 * im Befehl SetWhiteLed dieselben Felder wie früher (channel, state, mode,
 * bright), mode und bright aber mit den Werten der Kamera. Zeitplan und
 * Erkennungsarten aus der Antwort (LightingSchedule, wlAiDetectType …) stehen
 * nicht im Befehl; die Kamera behält sie, wie sie sind.
 *
 * Meldet die Kamera keinen brauchbaren Stand, schaltet der Hub für diesen
 * einen Befehl wie früher (mode 1, Helligkeit 100 oder die angegebene). Mit
 * HUB_SPOTLIGHT_LEGACY=1 immer so: Ob die Kamera ihr Licht auch in einem
 * anderen Lichtmodus auf state=1 einschaltet, zeigt erst die echte Kamera.
 */

/** Felder des früheren Befehls: Lichtmodus 1, Helligkeit 100 oder die angegebene. */
export const LEGACY_MODE = 1;
export const LEGACY_BRIGHTNESS = 100;

/** Inhalt von WhiteLed im Befehl SetWhiteLed, ohne channel (setzt der Aufrufer). */
export interface WhiteLedParam {
  state: 0 | 1;
  mode: number;
  bright?: number;
}

/** HUB_SPOTLIGHT_LEGACY: 1, true, ja, on (auch yes) stellt den früheren Befehl her. */
export function spotlightLegacy(env: string | undefined): boolean {
  return /^(1|true|on|yes|ja)$/i.test((env ?? "").trim());
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Ausdrücklich angegebene Helligkeit auf 1–100 begrenzen; keine Zahl = keine Angabe. */
function explicitBrightness(brightness: number | undefined): number | undefined {
  if (typeof brightness !== "number" || !Number.isFinite(brightness)) return undefined;
  return Math.min(100, Math.max(1, Math.round(brightness)));
}

/**
 * Lichtmodus, wie die Kamera ihn meldet (Feld mode der Antwort auf
 * GetWhiteLed); null, wenn er nicht als ganze Zahl vorliegt.
 */
export function reportedLedMode(current: unknown): number | null {
  return isRecord(current) && isIntIn(current.mode, 0, Number.MAX_SAFE_INTEGER) ? current.mode : null;
}

/**
 * Befehl für SetWhiteLed aus dem Stand, den die Kamera auf GetWhiteLed meldet
 * (`current` = das Feld WhiteLed der Antwort): Nur `state` ändert sich.
 * `mode` bleibt, wie die Kamera ihn meldet; `bright` ebenso, außer beim
 * Einschalten mit ausdrücklich angegebener Helligkeit. Meldet die Kamera
 * keine Helligkeit, fehlt bright im Befehl. Alle übrigen Felder der Antwort
 * stehen nicht im Befehl.
 *
 * null: kein brauchbarer Stand (keine Antwort, state nicht 0/1, mode keine
 * ganze Zahl) – dann entscheidet der Aufrufer (spotlightCommand).
 */
export function whiteLedParam(current: unknown, on: boolean, brightness?: number): WhiteLedParam | null {
  if (!isRecord(current)) return null;
  if (!isIntIn(current.state, 0, 1)) return null;
  const mode = reportedLedMode(current);
  if (mode === null) return null;
  const param: WhiteLedParam = { state: on ? 1 : 0, mode };
  const wanted = on ? explicitBrightness(brightness) : undefined;
  if (wanted !== undefined) param.bright = wanted;
  else if (isIntIn(current.bright, 0, 100)) param.bright = current.bright;
  return param;
}

/** Der frühere Befehl: Lichtmodus 1 und Helligkeit (100 oder die angegebene), auch beim Ausschalten. */
export function legacyWhiteLedParam(on: boolean, brightness?: number): WhiteLedParam {
  return { state: on ? 1 : 0, mode: LEGACY_MODE, bright: explicitBrightness(brightness) ?? LEGACY_BRIGHTNESS };
}

export interface SpotlightCommand {
  param: WhiteLedParam;
  /**
   * `keep`: Lichtmodus und Helligkeit der Kamera bleiben;
   * `legacy`: früherer Befehl per HUB_SPOTLIGHT_LEGACY;
   * `fallback`: früherer Befehl, weil die Kamera keinen brauchbaren Stand meldete.
   */
  how: "keep" | "legacy" | "fallback";
}

/** Welcher Befehl an die Kamera geht. */
export function spotlightCommand(s: {
  legacy: boolean;
  /** Feld WhiteLed der Antwort auf GetWhiteLed; null = nicht lesbar. */
  current: unknown;
  on: boolean;
  /** Nur bei ausdrücklichem Wunsch des Aufrufers, wirkt nur beim Einschalten. */
  brightness?: number;
}): SpotlightCommand {
  if (s.legacy) return { param: legacyWhiteLedParam(s.on, s.brightness), how: "legacy" };
  const param = whiteLedParam(s.current, s.on, s.brightness);
  if (param) return { param, how: "keep" };
  return { param: legacyWhiteLedParam(s.on, s.brightness), how: "fallback" };
}

/**
 * Zusatz für die Log-Zeile je Burst im Dunkeln: der Lichtmodus, wie die
 * Kamera ihn vor dem Schalten gemeldet hat; leer, wenn er nicht vorliegt.
 */
export function ledModeNote(current: unknown): string {
  const mode = reportedLedMode(current);
  return mode === null ? "" : `Lichtmodus laut Kamera mode=${mode}`;
}
