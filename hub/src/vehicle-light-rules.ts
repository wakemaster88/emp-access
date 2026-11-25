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

/**
 * Ob der Burst das Weißlicht selbst schaltet (ein, und am Ende wieder aus).
 * Ein Licht, das schon brennt, hat jemand von Hand eingeschaltet: Der Burst
 * nutzt es und lässt es, wie es ist. Anders, wenn der Hub es in diesem
 * Augenblick selbst ausschaltet (ein gemerktes Licht, dessen Ausschalten
 * nachgeholt wird): Die Kamera meldet es dann noch als brennend, beim ersten
 * Bild wäre es aus und das Kennzeichen im Dunkeln nicht lesbar.
 */
export function burstSwitchesLight(s: {
  /** Die Kamera meldet das Licht als brennend. */
  lit: boolean;
  /** Der Hub schaltet an dieser Kamera gerade ein gemerktes Licht aus. */
  goingOff: boolean;
}): boolean {
  return !s.lit || s.goingOff;
}

/**
 * So lange gilt der Merker „Weißlicht vom Hub eingeschaltet“. Danach wird er
 * verworfen: Was nach einem Tag an der Kamera brennt, hat jemand anderes
 * eingeschaltet.
 */
export const LIGHT_MARK_MAX_AGE_MS = 24 * 3_600_000;
/** Abstand der Versuche, ein gemerktes Licht auszuschalten. */
export const LIGHT_MARK_RETRY_MS = 60_000;

export interface LightMarkState {
  now: number;
  /** Wann der Hub das Licht laut Merker eingeschaltet hat. */
  markedAt: number;
  /** Die Kamera steht in der Kamera-Liste. */
  known: boolean;
  /** Ihre letzte Abfrage hat geantwortet. */
  reachable: boolean;
  /** An der Kamera läuft gerade ein Burst: Er braucht das Licht. */
  inUse: boolean;
  /** Letzter Versuch, dieses Licht auszuschalten (0 = noch keiner). */
  lastTryAt: number;
}

/**
 * Was mit einem gemerkten Licht geschieht, das zu keinem laufenden Burst
 * mehr gehört (nach einem Neustart: die Lichter des vorigen Prozesses):
 * - `off`: jetzt ausschalten – die Kamera ist bekannt und antwortet;
 * - `wait`: später wieder fragen (Burst läuft, Kamera unbekannt oder nicht
 *   erreichbar, letzter Versuch keine Minute her);
 * - `drop`: Merker verwerfen, ohne die Kamera anzufassen (älter als 24 h).
 * Nur Lichter mit Merker kommen hierher: Eines, das der Hub nicht
 * eingeschaltet hat, wird nie ausgeschaltet.
 */
export function lightMarkStep(s: LightMarkState): "off" | "wait" | "drop" {
  if (s.inUse) return "wait";
  if (s.now - s.markedAt > LIGHT_MARK_MAX_AGE_MS) return "drop";
  if (!s.known || !s.reachable) return "wait";
  if (s.lastTryAt > 0 && s.now - s.lastTryAt < LIGHT_MARK_RETRY_MS) return "wait";
  return "off";
}
