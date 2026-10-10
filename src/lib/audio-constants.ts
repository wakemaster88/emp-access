/**
 * Reine Konstanten und Hilfsfunktionen des Audio-Moduls – ohne Server-Importe,
 * damit sie auch in Client-Komponenten verwendet werden können.
 */

import {
  describeInstant,
  operatingSpanState,
  type ScheduleSpec,
  type SpanOffsets,
} from "./operating-hours";

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

// ── AirPlay/Bluetooth: Empfänger, die eine Zone übernehmen können ────────────

export type AudioExternal = "AIRPLAY" | "BLUETOOTH";

/**
 * Programme, die den Empfang leisten. Der Abspieler meldet im Heartbeat, welche
 * davon auf ihm installiert sind (`systemInfo.audio_backends`) – ohne das würde
 * das Dashboard eine Einstellung anbieten, die der Pi still ignoriert.
 */
export const AUDIO_BACKENDS: Record<AudioExternal, string> = {
  AIRPLAY: "shairport",
  BLUETOOTH: "bluealsa",
};

/** Dauer des Bluetooth-Kopplungsfensters in Sekunden. */
export const PAIRING_WINDOW_SEC = 300;

export function parseExternalKind(value: unknown): AudioExternal | undefined {
  return value === "AIRPLAY" || value === "BLUETOOTH" ? value : undefined;
}

/**
 * Restlaufzeit des Kopplungsfensters. Der Abspieler bekommt bewusst Sekunden
 * und keinen Zeitstempel: ein Pi ohne funkende Uhr wuerde ein Fenster sonst
 * falsch berechnen.
 */
export function pairableSeconds(pairableUntil: Date | null | undefined): number {
  if (!pairableUntil) return 0;
  const remaining = Math.ceil((pairableUntil.getTime() - Date.now()) / 1000);
  return remaining > 0 ? Math.min(remaining, PAIRING_WINDOW_SEC) : 0;
}

/** Backends, die der Abspieler im Heartbeat gemeldet hat. */
export function audioBackends(systemInfo: unknown): string[] {
  if (!systemInfo || typeof systemInfo !== "object") return [];
  const value = (systemInfo as { audio_backends?: unknown }).audio_backends;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function hasAudioBackend(backends: string[], kind: AudioExternal): boolean {
  return backends.includes(AUDIO_BACKENDS[kind]);
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
  schedule: { timeOfDay: string | null; daysOfWeek: number },
  now: Date,
  timeZone: string
): string | null {
  // Ohne Uhrzeit (Betriebsbeginn/-ende) rechnet `operating-hours.ts`.
  if (!schedule.timeOfDay) return null;
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

export type AudioScheduleTriggerKind = "TIME" | "OPENING" | "CLOSING";

export const AUDIO_TRIGGER_LABELS: Record<AudioScheduleTriggerKind, string> = {
  TIME: "Uhrzeit",
  OPENING: "Betriebsbeginn",
  CLOSING: "Betriebsende",
};

export const AUDIO_OPERATING_LABELS: Record<"ANY" | "OPEN" | "CLOSED", string> = {
  ANY: "Betriebszeit egal",
  OPEN: "nur während der Betriebszeit",
  CLOSED: "nur außerhalb der Betriebszeit",
};

/** "+15 Min." / "−1 Std." – Verschiebung gegenüber Betriebsbeginn/-ende. */
export function formatOffsetMinutes(minutes: number): string {
  if (minutes === 0) return "pünktlich";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  if (abs < 60) return `${sign}${abs} Min.`;
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return rest === 0 ? `${sign}${hours} Std.` : `${sign}${hours}:${String(rest).padStart(2, "0")} Std.`;
}

/** Kurzform des Zeitpunkts für die Zeitplan-Karte: "10:00" oder "Betriebsende −15 Min.". */
export function describeScheduleTiming(schedule: {
  trigger: AudioScheduleTriggerKind;
  timeOfDay: string | null;
  offsetMinutes: number;
}): string {
  if (schedule.trigger === "TIME") return schedule.timeOfDay ?? "–";
  return `${AUDIO_TRIGGER_LABELS[schedule.trigger]} ${formatOffsetMinutes(schedule.offsetMinutes)}`;
}

/** Bitmaske als lesbare Wochentagsliste. */
export function formatDaysOfWeek(bitmask: number): string {
  if (bitmask === 127) return "Täglich";
  if (bitmask === 31) return "Mo–Fr";
  if (bitmask === 96) return "Sa+So";
  const selected = WEEKDAY_NAMES.filter((_, i) => ((bitmask >> i) & 1) === 1);
  return selected.length === 0 ? "Nie" : selected.join(", ");
}

// ── Musik-Automatik ──────────────────────────────────────────────────────────

/** Größter Versatz gegenüber Betriebsbeginn/-ende: zwölf Stunden. */
export const MAX_OPERATING_OFFSET_MINUTES = 720;

/** Ganze Minuten im erlaubten Bereich, sonst null. Leer zählt als ungültig. */
export function parseOffsetMinutes(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || Math.abs(n) > MAX_OPERATING_OFFSET_MINUTES) return null;
  return n;
}

export type AudioMusicModeKind = "MANUAL" | "TIMES" | "OPERATING";

export const MUSIC_MODE_LABELS: Record<AudioMusicModeKind, string> = {
  MANUAL: "Aus",
  TIMES: "Eigene Zeiten",
  OPERATING: "Betriebszeit des Raums",
};

export function parseMusicMode(value: unknown): AudioMusicModeKind | undefined {
  return value === "MANUAL" || value === "TIMES" || value === "OPERATING" ? value : undefined;
}

/**
 * Musikfenster eines Wochentags; `to` vor `from` läuft über Mitternacht. Ein
 * `type` statt `interface`, damit es ohne Umweg als Json-Wert durchgeht.
 */
export type MusicTimeSpan = {
  /** 0 = Mo … 6 = So. */
  weekday: number;
  from: string;
  to: string;
};

/** "9:30" → "09:30"; null, wenn keine Uhrzeit. */
function normalizeHhmm(value: unknown): string | null {
  const time = parseTimeOfDay(value);
  return time ? time.padStart(5, "0") : null;
}

/**
 * Musikzeiten aus der Datenbank oder einem Request: gültige Fenster, höchstens
 * eins je Wochentag, nach Tag sortiert. Gleicher Start und gleiches Ende fällt
 * heraus – als Musikzeit ist das ein Tippfehler, kein „rund um die Uhr“.
 */
export function parseMusicTimes(value: unknown): MusicTimeSpan[] {
  if (!Array.isArray(value)) return [];
  const byDay = new Map<number, MusicTimeSpan>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const weekday = Number((entry as { weekday?: unknown }).weekday);
    const from = normalizeHhmm((entry as { from?: unknown }).from);
    const to = normalizeHhmm((entry as { to?: unknown }).to);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (!from || !to || from === to || byDay.has(weekday)) continue;
    byDay.set(weekday, { weekday, from, to });
  }
  return [...byDay.values()].sort((a, b) => a.weekday - b.weekday);
}

/**
 * Musik-Automatik aus einem Request. Fehlende Felder bleiben unverändert;
 * geprüft wird gegen den gespeicherten Stand `current`, damit auch eine
 * Teiländerung keine Zone mit „Eigene Zeiten“ ohne einen einzigen Tag ergibt.
 */
export function parseMusicSettings(
  body: { musicMode?: unknown; musicTimes?: unknown },
  current: { musicMode: AudioMusicModeKind; musicTimes: unknown } = { musicMode: "MANUAL", musicTimes: [] }
): { musicMode?: AudioMusicModeKind; musicTimes?: MusicTimeSpan[] } | { error: string } {
  const musicMode = body.musicMode === undefined ? undefined : parseMusicMode(body.musicMode);
  if (body.musicMode !== undefined && !musicMode) return { error: "Unbekannte Musik-Automatik" };

  let musicTimes: MusicTimeSpan[] | undefined;
  if (body.musicTimes !== undefined) {
    if (!Array.isArray(body.musicTimes)) return { error: "Musikzeiten müssen eine Liste sein" };
    musicTimes = parseMusicTimes(body.musicTimes);
    if (musicTimes.length !== body.musicTimes.length) {
      return {
        error: "Musikzeiten: je Tag Start und Ende als Uhrzeit angeben – nicht gleich, jeder Tag nur einmal",
      };
    }
  }

  const mode = musicMode ?? current.musicMode;
  const times = musicTimes ?? parseMusicTimes(current.musicTimes);
  if (mode === "TIMES" && times.length === 0) {
    return { error: "Für „Eigene Zeiten“ mindestens einen Tag mit Start und Ende angeben" };
  }
  return { musicMode, musicTimes };
}

/** Musikzeiten als ganzjähriges Profil – so rechnet dieselbe Fensterlogik wie bei der Betriebszeit. */
export function musicTimesSpec(times: MusicTimeSpan[]): ScheduleSpec {
  return {
    name: "Musikzeiten",
    seasons: [
      {
        name: "Musikzeiten",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: times.map((t) => ({ weekday: t.weekday, opensAt: t.from, closesAt: t.to })),
      },
    ],
    exceptions: [],
  };
}

/**
 * Musik-Automatik einer Zone: Im Fenster startet die Quelle von selbst, an
 * dessen Ende stoppt sie. Das Fenster kommt entweder aus den eigenen
 * Musikzeiten der Zone oder aus der Betriebszeit ihres Raums samt Versatz.
 */
export interface MusicWindowSettings {
  musicMode: AudioMusicModeKind;
  /** Rohwert aus der Datenbank, siehe `parseMusicTimes`. */
  musicTimes: unknown;
  musicOpenOffset: number;
  musicCloseOffset: number;
}

export interface MusicWindowState {
  /** Darf die Zone jetzt Musik spielen? */
  allowed: boolean;
  /** Wann der Zustand kippt; null = bis auf Weiteres. */
  until: Date | null;
}

/**
 * Profil und Versatz, nach denen sich das Musikfenster richtet. null heißt
 * keine Automatik – auch bei der Kopplung an einen Raum ohne Betriebszeit,
 * denn ein Raum ohne Profil soll keine Zone stumm schalten, wie bei den Regeln.
 */
export function musicWindowSource(
  zone: MusicWindowSettings,
  roomSchedule: ScheduleSpec | null | undefined
): { spec: ScheduleSpec; offsets: SpanOffsets } | null {
  if (zone.musicMode === "TIMES") {
    const times = parseMusicTimes(zone.musicTimes);
    if (times.length === 0) return null;
    return { spec: musicTimesSpec(times), offsets: { openMinutes: 0, closeMinutes: 0 } };
  }
  if (zone.musicMode === "OPERATING" && roomSchedule) {
    return {
      spec: roomSchedule,
      offsets: { openMinutes: zone.musicOpenOffset, closeMinutes: zone.musicCloseOffset },
    };
  }
  return null;
}

/** Darf die Zone jetzt Musik spielen, und bis wann? Ohne Automatik immer. */
export function musicWindowState(
  zone: MusicWindowSettings,
  roomSchedule: ScheduleSpec | null | undefined,
  now: Date,
  timeZone: string | null | undefined
): MusicWindowState {
  const source = musicWindowSource(zone, roomSchedule);
  if (!source) return { allowed: true, until: null };
  const state = operatingSpanState(source.spec, now, timeZone, source.offsets);
  return { allowed: state.inside, until: state.until };
}

/** Wochentage als "Di–Fr", "Sa, So" oder "täglich". */
function formatWeekdays(weekdays: number[]): string {
  if (weekdays.length === 7) return "täglich";
  const runs: number[][] = [];
  for (const day of weekdays) {
    const run = runs[runs.length - 1];
    if (run && day === run[run.length - 1] + 1) run.push(day);
    else runs.push([day]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${WEEKDAY_NAMES[run[0]]}–${WEEKDAY_NAMES[run[run.length - 1]]}`
        : run.map((day) => WEEKDAY_NAMES[day]).join(", ")
    )
    .join(", ");
}

/** "Di–Fr 12:00–20:00 · Sa, So 10:00–20:00" – Tage mit gleichen Zeiten zusammengefasst. */
export function formatMusicTimes(times: MusicTimeSpan[]): string {
  const groups = new Map<string, number[]>();
  for (const t of times) {
    const key = `${t.from}–${t.to}`;
    groups.set(key, [...(groups.get(key) ?? []), t.weekday]);
  }
  return [...groups.entries()]
    .map(([span, weekdays]) => `${formatWeekdays(weekdays)} ${span}`)
    .join(" · ");
}

/**
 * Einstellung als Klartext: "Musik Di–Fr 12:00–20:00" bzw. "Musik von
 * Betriebsbeginn −30 Min. bis Betriebsende"; null ohne Automatik.
 */
export function describeMusicWindow(zone: MusicWindowSettings): string | null {
  if (zone.musicMode === "TIMES") {
    const times = parseMusicTimes(zone.musicTimes);
    return times.length > 0 ? `Musik ${formatMusicTimes(times)}` : null;
  }
  if (zone.musicMode !== "OPERATING") return null;
  if (zone.musicOpenOffset === 0 && zone.musicCloseOffset === 0) return "Musik zur Betriebszeit";
  const open =
    zone.musicOpenOffset === 0
      ? "Betriebsbeginn"
      : `Betriebsbeginn ${formatOffsetMinutes(zone.musicOpenOffset)}`;
  const close =
    zone.musicCloseOffset === 0
      ? "Betriebsende"
      : `Betriebsende ${formatOffsetMinutes(zone.musicCloseOffset)}`;
  return `Musik von ${open} bis ${close}`;
}

/**
 * Was die Automatik gerade tut: "Musik an bis 20:00", "Musik aus bis morgen
 * 12:00" oder – wenn keine Musikzeit kommt – eine Warnung. null ohne
 * Automatik. `warn` markiert eine Zone, die auf absehbare Zeit stumm bleibt.
 */
export function describeMusicState(
  zone: MusicWindowSettings,
  roomSchedule: ScheduleSpec | null | undefined,
  now: Date,
  timeZone: string | null | undefined
): { text: string; warn: boolean } | null {
  if (!musicWindowSource(zone, roomSchedule)) {
    return zone.musicMode === "OPERATING"
      ? { text: "Musik-Automatik wirkt nicht – kein Raum mit Betriebszeit", warn: true }
      : null;
  }
  const state = musicWindowState(zone, roomSchedule, now, timeZone);
  if (state.allowed) {
    return {
      text: state.until ? `Musik an bis ${describeInstant(state.until, now, timeZone)}` : "Musik an",
      warn: false,
    };
  }
  if (!state.until) return { text: "Musik aus – keine Musikzeit in den nächsten Tagen", warn: true };
  return { text: `Musik aus bis ${describeInstant(state.until, now, timeZone)}`, warn: false };
}
