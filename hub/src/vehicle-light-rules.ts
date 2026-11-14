/**
 * Weißlicht bei Fahrzeug-Burst (reine Logik, testbar).
 *
 * Nachts liest die Kamera Eingang keine Kennzeichen: Das Infrarotbild ist zu
 * flau, die OCR liefert pro Bild etwas anderes (Befund 14.11.2026: seit
 * Sonnenuntergang 0 Treffer, Sicherheit 0,5–0,7). Aaron hat entschieden, dass
 * der Hub nachts bei einem erkannten Fahrzeug kurz das Weißlicht der Kamera
 * einschaltet. Hier steht nur, WANN und an WELCHER Kamera.
 */
import { berlinWall } from "./camera-clock.js";

/** Sonnenauf-/-untergang eines Tages (ISO, UTC), wie aus weather.ts. */
export interface SunTimes {
  sunrise: string | null;
  sunset: string | null;
}

/**
 * Dunkel = vor Sonnenaufgang oder nach Sonnenuntergang, mit Puffer (in der
 * Dämmerung liest die Kamera schon schlecht). Ohne Wetterdaten: feste
 * Winterzeiten 17–8 Uhr Berlin – lieber einmal zu oft Licht als ein
 * geschlossenes Tor.
 */
export function isDark(now: Date, days: SunTimes[], marginMin = 30): boolean {
  const t = now.getTime();
  const margin = marginMin * 60_000;
  for (const d of days) {
    if (!d.sunrise || !d.sunset) continue;
    const rise = Date.parse(d.sunrise);
    const set = Date.parse(d.sunset);
    if (!Number.isFinite(rise) || !Number.isFinite(set)) continue;
    // Tag finden, zu dem `now` gehört (gleiches Kalenderdatum in UTC reicht in Mitteleuropa).
    const dayStart = rise - 6 * 3_600_000;
    const dayEnd = set + 6 * 3_600_000;
    if (t < dayStart || t > dayEnd) continue;
    return t < rise + margin || t > set - margin;
  }
  const h = berlinWall(now).hour;
  return h >= 17 || h < 8;
}

/**
 * Welche Kamera bekommt das Licht?
 * - `HUB_VEHICLE_SPOTLIGHT=0|off` → keine
 * - `HUB_VEHICLE_SPOTLIGHT=3,9` → genau diese Kamera-IDs
 * - sonst (Standard): Kameras an der Zufahrt (Name mit Eingang/Einfahrt/Tor),
 *   damit nachts nicht an jeder Hallenkamera das Licht angeht.
 * Die Kamera muss außerdem ein Weißlicht haben (caps.spotlight).
 */
export function spotlightWanted(
  cam: { id: number; name: string },
  hasSpotlight: boolean,
  env: string | undefined
): boolean {
  if (!hasSpotlight) return false;
  const v = (env ?? "").trim().toLowerCase();
  if (v === "0" || v === "off" || v === "aus" || v === "false") return false;
  if (/^\d+(\s*,\s*\d+)*$/.test(v)) {
    return v.split(",").map((s) => Number(s.trim())).includes(cam.id);
  }
  return /eingang|einfahrt|\btor\b|zufahrt/i.test(cam.name);
}
