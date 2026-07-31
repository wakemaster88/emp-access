/**
 * Reine Konstanten und Hilfsfunktionen des Audio-Moduls – ohne Server-Importe,
 * damit sie auch in Client-Komponenten verwendet werden können.
 */

/** Ansagen, die zu lang sind, blockieren die Zone unnötig lange. */
export const MAX_ANNOUNCEMENT_CHARS = 600;

/** Standardstimme, wenn die Durchsage keine eigene setzt. */
export const DEFAULT_TTS_VOICE = "eve";

/** Ansagen sind deutsch; eine feste Sprache klingt gleichmäßiger als `auto`. */
export const TTS_LANGUAGE = "de";

export interface TtsVoice {
  value: string;
  label: string;
}

/**
 * Notnagel für den Stimmenauswahl-Dialog: Welche Stimmen es wirklich gibt,
 * beantwortet die API selbst (siehe listTtsVoices). Diese hier sind belegt und
 * genügen, solange die Abfrage nicht durchkommt.
 */
export const TTS_FALLBACK_VOICES: TtsVoice[] = [
  { value: "eve", label: "Eve (weiblich, Standard)" },
  { value: "ara", label: "Ara (weiblich)" },
  { value: "leo", label: "Leo (männlich)" },
  { value: "rex", label: "Rex (männlich)" },
];

/** Stimmen des früheren Anbieters, die noch an alten Durchsagen hängen. */
const LEGACY_VOICES = new Set(["alloy", "echo", "fable", "nova", "onyx", "shimmer"]);

/**
 * Eine Durchsage von früher trägt eine Stimme, die es bei xAI nicht gibt – ein
 * erneutes Rendern würde daran scheitern. Solche Namen fallen auf die
 * Standardstimme zurück.
 */
export function normalizeTtsVoice(voice: string | null | undefined): string {
  const trimmed = voice?.trim();
  if (!trimmed || LEGACY_VOICES.has(trimmed.toLowerCase())) return DEFAULT_TTS_VOICE;
  return trimmed;
}

/** Ohne Heartbeat in diesem Zeitraum gilt ein Abspieler als offline. */
export const AUDIO_PLAYER_OFFLINE_AFTER_MS = 5 * 60 * 1000;

export function isPlayerOnline(lastUpdate: Date | null | undefined): boolean {
  if (!lastUpdate) return false;
  return Date.now() - lastUpdate.getTime() < AUDIO_PLAYER_OFFLINE_AFTER_MS;
}

export function clampVolume(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Quellenart aus einer Eingabe, oder undefined = unveraendert lassen. */
export function parseSourceKind(value: unknown): "SILENCE" | "PLAYLIST" | "STREAM" | undefined {
  return value === "SILENCE" || value === "PLAYLIST" || value === "STREAM" ? value : undefined;
}

/** "HH:mm" oder null. */
export function parseTimeOfDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : null;
}

export function parseDaysOfWeek(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 127;
  return Math.min(127, Math.max(0, Math.round(n)));
}

/** Zonen-ID-Array aus einem Json-Feld oder Request-Body. */
export function parseZoneIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

const WEEKDAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Wochentag in einer Zeitzone als Index, bit0 = Montag. -1 = unbekannt. */
function localWeekdayIndex(date: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
}

/** Wochentag-Bitmaske gegen ein Datum prüfen (bit0 = Montag). */
export function matchesDayOfWeek(bitmask: number, date: Date, timeZone: string): boolean {
  const index = localWeekdayIndex(date, timeZone);
  if (index < 0) return false;
  return ((bitmask >> index) & 1) === 1;
}

/**
 * Nachholfenster der Zeitplan-Auswertung in Minuten. Vercel startet Cron-Jobs
 * nicht sekundengenau und lässt einen Tick unter Last auch aus. Ohne Fenster
 * fiele eine Durchsage dann still für den ganzen Tag aus, weil ihre Minute
 * vorbei ist.
 */
export const SCHEDULE_WINDOW_MINUTES = 5;

/** Tagesdatum und Minute des Tages in einer Zeitzone. */
function localParts(date: Date, timeZone: string): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "0";
  // Mitternacht liefert je nach Umgebung "24" statt "00".
  const hour = Number(value("hour")) % 24;
  return {
    day: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: hour * 60 + Number(value("minute")),
  };
}

export type ScheduleTiming = {
  timeOfDay: string;
  daysOfWeek: number;
  lastRunAt: Date | null;
};

/**
 * Ist ein Zeitplan jetzt auszuführen? Ohne Datenbankzugriff, damit sich die
 * Zeitlogik prüfen lässt: npx tsx scripts/audio-schedule-check.ts
 */
export function isScheduleDue(
  schedule: ScheduleTiming,
  now: Date,
  timeZone: string
): boolean {
  if (!matchesDayOfWeek(schedule.daysOfWeek, now, timeZone)) return false;

  const [hour, minute] = schedule.timeOfDay.split(":").map(Number);
  const due = hour * 60 + minute;
  const current = localParts(now, timeZone);
  if (current.minutes < due || current.minutes >= due + SCHEDULE_WINDOW_MINUTES) return false;

  if (schedule.lastRunAt) {
    const last = localParts(schedule.lastRunAt, timeZone);
    // Heute schon für diese Uhrzeit gelaufen. Ohne diese Prüfung würde jeder
    // weitere Tick im Nachholfenster die Durchsage wiederholen.
    if (last.day === current.day && last.minutes >= due) return false;
  }

  return true;
}

/**
 * Nächster Termin als Klartext („heute 18:30“, „morgen 09:00“, „Sa 09:00“).
 * null, wenn kein Wochentag gewählt ist – dann kommt der Termin nie.
 *
 * Bewusst nur eine Beschriftung und kein Zeitpunkt: gebraucht wird die Angabe
 * ausschließlich zur Anzeige, und so bleibt die Rechnung ohne Umkehrung der
 * Zeitzone (Ortszeit → UTC), die an den Umstellungstagen mehrdeutig wäre.
 */
export function nextScheduleRunLabel(
  schedule: { timeOfDay: string; daysOfWeek: number },
  now: Date,
  timeZone: string
): string | null {
  const today = localWeekdayIndex(now, timeZone);
  if (today < 0) return null;

  const [hour, minute] = schedule.timeOfDay.split(":").map(Number);
  const due = hour * 60 + minute;
  const nowMinutes = localParts(now, timeZone).minutes;

  // Bis 7 Tage weiter: ist nur der heutige Wochentag gewählt und die Uhrzeit
  // vorbei, ist der nächste Termin derselbe Tag nächste Woche.
  for (let offset = 0; offset <= 7; offset++) {
    const weekday = (today + offset) % 7;
    if (((schedule.daysOfWeek >> weekday) & 1) === 0) continue;
    // Solange das Nachholfenster läuft, bleibt der Termin von heute stehen –
    // sonst springt die Anzeige auf morgen, während die Durchsage noch ansteht.
    if (offset === 0 && nowMinutes >= due + SCHEDULE_WINDOW_MINUTES) continue;
    if (offset === 0) return `heute ${schedule.timeOfDay}`;
    if (offset === 1) return `morgen ${schedule.timeOfDay}`;
    return `${WEEKDAY_NAMES[weekday]} ${schedule.timeOfDay}`;
  }
  return null;
}

/** Bitmaske als lesbare Wochentagsliste. */
export function formatDaysOfWeek(bitmask: number): string {
  if (bitmask === 127) return "Täglich";
  if (bitmask === 31) return "Mo–Fr";
  if (bitmask === 96) return "Sa+So";
  const selected = WEEKDAY_NAMES.filter((_, i) => ((bitmask >> i) & 1) === 1);
  return selected.length === 0 ? "Nie" : selected.join(", ");
}

/** Prüft, ob `time` ("HH:mm") in der Ruhezeit einer Zone liegt. */
export function isQuietTime(
  quietFrom: string | null,
  quietTo: string | null,
  time: string
): boolean {
  if (!quietFrom || !quietTo) return false;
  if (quietFrom === quietTo) return false;
  // Fenster über Mitternacht (z. B. 22:00–06:00).
  if (quietFrom > quietTo) return time >= quietFrom || time < quietTo;
  return time >= quietFrom && time < quietTo;
}
