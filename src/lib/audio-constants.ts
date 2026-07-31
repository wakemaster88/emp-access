/**
 * Reine Konstanten und Hilfsfunktionen des Audio-Moduls – ohne Server-Importe,
 * damit sie auch in Client-Komponenten verwendet werden können.
 */

/** Ansagen, die zu lang sind, blockieren die Zone unnötig lange. */
export const MAX_ANNOUNCEMENT_CHARS = 600;

/** Standardstimme, wenn die Durchsage keine eigene setzt. */
export const DEFAULT_TTS_VOICE = "alloy";

export const TTS_VOICES = [
  { value: "alloy", label: "Alloy (neutral)" },
  { value: "echo", label: "Echo (männlich)" },
  { value: "fable", label: "Fable (warm)" },
  { value: "nova", label: "Nova (weiblich)" },
  { value: "onyx", label: "Onyx (tief)" },
  { value: "shimmer", label: "Shimmer (hell)" },
] as const;

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

/** Wochentag-Bitmaske gegen ein Datum prüfen (bit0 = Montag). */
export function matchesDayOfWeek(bitmask: number, date: Date, timeZone: string): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  if (index < 0) return false;
  return ((bitmask >> index) & 1) === 1;
}

/** Bitmaske als lesbare Wochentagsliste. */
export function formatDaysOfWeek(bitmask: number): string {
  if (bitmask === 127) return "Täglich";
  if (bitmask === 31) return "Mo–Fr";
  if (bitmask === 96) return "Sa+So";
  const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const selected = names.filter((_, i) => ((bitmask >> i) & 1) === 1);
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
