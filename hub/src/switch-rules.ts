/**
 * Schalter aus hub/.env lesen (z. B. HUB_EMERGENCY_COVER_CLOSE,
 * HUB_RULES_LOCAL_MOTION). Reine Logik.
 */

const OFF = new Set(["0", "false", "nein", "aus", "no", "off"]);
const ON = new Set(["1", "true", "ja", "an", "yes", "on"]);

/**
 * An oder aus; leer oder unbekannt = `fallback`. Gross- und Kleinschreibung
 * zaehlt nicht. Ein unbekannter Wert (etwa ein Tippfehler) geht an
 * `onUnknown`, damit der Aufrufer ihn einmal meldet (`unknownSwitchLine`).
 */
export function envSwitch(raw: string | undefined, fallback = true, onUnknown?: (value: string) => void): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (OFF.has(v)) return false;
  if (ON.has(v)) return true;
  if (v !== "") onUnknown?.((raw ?? "").trim());
  return fallback;
}

/** Log-Zeile zu einem unbekannten Wert: Name, Wert, was gilt und was abschaltet. */
export function unknownSwitchLine(name: string, value: string, fallback = true): string {
  return (
    `Warnung: ${name}=${JSON.stringify(value.slice(0, 40))} ist kein bekannter Wert – ` +
    `bleibt ${fallback ? "an" : "aus"} (Standard). Aus: ${[...OFF].join(", ")}; an: ${[...ON].join(", ")}`
  );
}
