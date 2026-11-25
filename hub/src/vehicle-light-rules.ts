/**
 * Weißlicht bei Fahrzeug-Burst (reine Logik, testbar).
 *
 * Nachts liest die Kamera Eingang keine Kennzeichen: Das Infrarotbild ist zu
 * flau, die OCR liefert pro Bild etwas anderes (Befund 14.11.2026: seit
 * Sonnenuntergang 0 Treffer, Sicherheit 0,5–0,7). Darum schaltet der Hub
 * nachts bei einem erkannten Fahrzeug kurz das Weißlicht der Kamera ein.
 * Hier steht, WANN, an WELCHER Kamera – und aus welchem Grund ein Burst im
 * Dunkeln kein Licht bekommt (lightDecision, eine Log-Zeile je Burst).
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

/** Warum ein Fahrzeug-Burst kein Weißlicht bekommt. */
export type LightSkipReason =
  /** Per Umgebung abgeschaltet (HUB_VEHICLE_SPOTLIGHT=0). */
  | "off"
  /** Sperre nach einem Licht-Burst ohne Fahrzeug. */
  | "muted"
  /** Es ist hell. */
  | "day"
  /** Kamera ist nicht für das Licht vorgesehen (Name oder HUB_VEHICLE_SPOTLIGHT=IDs). */
  | "not_selected"
  /** Kamera hat kein Weißlicht. */
  | "no_light"
  /** Die Kamera meldet ihr Licht schon als an (von Hand oder eigene Automatik). */
  | "already_on"
  /** Der Fahrzeug-Alarm ist schon wieder aus. */
  | "alarm_gone"
  /** Der Hub wird gerade beendet: kein Einschalten mehr (vehicle-light.ts). */
  | "exiting";

/**
 * Was der Hub zum Zeitpunkt der Entscheidung weiß. Die hinteren Angaben
 * kosten eine Abfrage (Wetter, Kamera) und werden erst geholt, wenn
 * lightDecision danach fragt: `undefined` = noch nicht ermittelt.
 */
export interface LightFacts {
  /** HUB_VEHICLE_SPOTLIGHT. */
  env: string | undefined;
  cam: { id: number; name: string };
  now: number;
  /** Ende der Sperre nach einem leeren Licht-Burst (ms), falls gesetzt. */
  mutedUntil?: number | null;
  dark?: boolean;
  /** Die Kamera hat ein Weißlicht (caps.spotlight); null = Fähigkeiten nicht lesbar. */
  hasLight?: boolean | null;
  /** Antwort der Kamera auf GetWhiteLed; null = nicht lesbar. */
  led?: { state?: number; mode?: number } | null;
  /**
   * Der Hub schaltet an dieser Kamera gerade ein gemerktes Licht aus
   * (festgehalten vor der Abfrage von `led`, siehe burstSwitchesLight).
   */
  goingOff?: boolean;
  /** Der Fahrzeug-Alarm steht noch; null = nicht lesbar. */
  alarm?: boolean | null;
}

export type LightDecision =
  | { light: "on" }
  | { light: "off"; reason: LightSkipReason }
  /** Diese Angabe fehlt noch für die Entscheidung. */
  | { light: "need"; fact: "dark" | "hasLight" | "led" | "alarm" };

function spotlightOff(env: string | undefined): boolean {
  const v = (env ?? "").trim().toLowerCase();
  return v === "0" || v === "off" || v === "aus" || v === "false";
}

/**
 * Bekommt dieser Burst Weißlicht – und wenn nicht, warum nicht?
 *
 * Die Reihenfolge ist die der Kosten: erst, was der Hub ohne Abfrage weiß
 * (Umgebung, Sperre), dann die Dunkelheit, dann die Kamera selbst (Weißlicht
 * vorhanden, Licht schon an, Alarm noch da). Fehlt die nächste Angabe, nennt
 * das Ergebnis sie (`need`); der Aufrufer holt sie und fragt erneut. So fällt
 * die Entscheidung mit so wenigen Abfragen wie möglich, und jede Stelle, an
 * der kein Licht geschaltet wird, hat einen Grund fürs Log.
 *
 * Nicht lesbare Angaben der Kamera (null) verhindern das Licht nicht: Ob es
 * schaltbar ist, zeigt der Schaltversuch. Ausnahme sind die Fähigkeiten:
 * Ohne sie bleibt das Licht aus, damit an Kameras ohne Weißlicht nichts
 * geschaltet wird.
 */
export function lightDecision(f: LightFacts): LightDecision {
  if (spotlightOff(f.env)) return { light: "off", reason: "off" };
  if (f.mutedUntil && f.now < f.mutedUntil) return { light: "off", reason: "muted" };
  if (f.dark === undefined) return { light: "need", fact: "dark" };
  if (!f.dark) return { light: "off", reason: "day" };
  if (!spotlightWanted(f.cam, true, f.env)) return { light: "off", reason: "not_selected" };
  if (f.hasLight === undefined) return { light: "need", fact: "hasLight" };
  if (!f.hasLight) return { light: "off", reason: "no_light" };
  if (f.led === undefined) return { light: "need", fact: "led" };
  if (!burstSwitchesLight({ lit: f.led?.state === 1, goingOff: f.goingOff === true })) {
    return { light: "off", reason: "already_on" };
  }
  if (f.alarm === undefined) return { light: "need", fact: "alarm" };
  if (f.alarm === false) return { light: "off", reason: "alarm_gone" };
  return { light: "on" };
}

/**
 * Steht der Grund im Log? Genau dann, wenn es dunkel ist: Bei Tag braucht
 * kein Burst Licht, eine Zeile je Burst wäre dort nur Rauschen. `dark`
 * fehlt, wenn die Entscheidung schon vor der Dunkelheit fiel (abgeschaltet,
 * gesperrt); dann zählt `darkWithoutFetch`, die Dunkelheit nach dem zuletzt
 * geladenen Wetterbericht, ohne neuen Abruf.
 */
export function lightSkipLogged(f: { dark?: boolean; darkWithoutFetch: () => boolean }): boolean {
  return f.dark ?? f.darkWithoutFetch();
}

/** Zustand des Lichts, wie ihn die Kamera meldet – fürs Log. */
export function ledText(led: { state?: number; mode?: number } | null | undefined): string {
  if (!led) return "Zustand nicht lesbar";
  return `state=${led.state ?? "?"}, mode=${led.mode ?? "?"}`;
}

/** Grund als Text für die Log-Zeile „dunkel – kein Weißlicht (…)“. */
export function lightSkipText(
  reason: LightSkipReason,
  f: Pick<LightFacts, "mutedUntil" | "led" | "hasLight">
): string {
  switch (reason) {
    case "off":
      return "per HUB_VEHICLE_SPOTLIGHT abgeschaltet";
    case "muted": {
      if (!f.mutedUntil) return "gesperrt";
      const t = berlinWall(new Date(f.mutedUntil));
      return `gesperrt bis ${String(t.hour).padStart(2, "0")}:${String(t.min).padStart(2, "0")}`;
    }
    case "day":
      return "es ist hell";
    case "not_selected":
      return "Kamera nicht für das Weißlicht vorgesehen";
    case "no_light":
      return f.hasLight === null ? "Fähigkeiten der Kamera nicht lesbar" : "Kamera ohne Weißlicht";
    case "already_on":
      return `Licht laut Kamera schon an (${ledText(f.led)})`;
    case "alarm_gone":
      return "Alarm schon vorbei";
    case "exiting":
      return "Hub wird beendet";
  }
}

/**
 * Sperre nach einem Licht-Burst: nur, wenn mindestens ein Bild ausgewertet
 * wurde (Kennzeichen-Suche und Fahrzeug-Prüfung) und keines ein Kennzeichen
 * oder Fahrzeug zeigte. Dann hat das Licht nichts gebracht, und sein Ein- und
 * Ausschalten löst an der Kamera gern den nächsten Alarm aus. Ein Burst, der
 * ohne ausgewertetes Bild endet (erstes Bild nicht abrufbar), sperrt nicht.
 *
 * Mit HUB_VEHICLE_LIGHT_MIN_FRAMES (`minFrames`) sind das im Licht-Burst
 * mindestens so viele Bilder. Vorher endet er nur nach einer Schaltung (dann
 * hat ein Bild ein Kennzeichen gezeigt) oder weil ein Bild nicht abrufbar
 * war; dann sperrt er nicht, ein kurzer Aussetzer der Kamera nimmt dem
 * nächsten Fahrzeug so nicht das Licht.
 */
export function lightMuteDue(run: { evaluated: number; shown: boolean; minFrames?: number }): boolean {
  return run.evaluated >= Math.max(1, run.minFrames ?? 0) && !run.shown;
}

/** Standard für HUB_VEHICLE_LIGHT_MIN_FRAMES: 8 Bilder, rund 7 Sekunden Licht. */
export const LIGHT_MIN_FRAMES_DEFAULT = 8;

/**
 * HUB_VEHICLE_LIGHT_MIN_FRAMES: So viele erste Bilder nimmt ein Burst, für
 * den der Hub das Weißlicht eingeschaltet hat, unabhängig vom Alarm auf
 * (burstStep in vehicle-burst-rules.ts). Standard 8; 0 = der Alarm
 * entscheidet wie ohne Licht. Begrenzt auf 0 bis zur Bildzahl des Bursts;
 * leer oder keine Zahl ergibt den Standard.
 */
export function lightMinFrames(env: string | undefined, maxFrames: number): number {
  const max = Math.max(0, Math.floor(maxFrames));
  const raw = (env ?? "").trim();
  const n = raw === "" ? Number.NaN : Number(raw);
  const wanted = Number.isFinite(n) ? Math.floor(n) : LIGHT_MIN_FRAMES_DEFAULT;
  return Math.min(Math.max(0, wanted), max);
}
