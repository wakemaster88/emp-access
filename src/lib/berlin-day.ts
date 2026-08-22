/**
 * Hilfen für Kalendertage in Europe/Berlin (Einchecken / Monitor / Dashboard).
 *
 * Auf Vercel ist die Runtime-Zeitzone UTC – `setHours(0,0,0,0)` und
 * `getHours()` liegen dann zwei Stunden neben dem Parkbetrieb.
 */

const TZ = "Europe/Berlin";
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function berlinYmd(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("sv-SE", { timeZone: TZ });
}

export function isBerlinYmd(value: string): boolean {
  return YMD_RE.test(value);
}

/** Liegt der Scan-Zeitpunkt am selben Berlin-Kalendertag wie `reference`? */
export function isSameBerlinDay(scanTime: Date | string, reference: Date = new Date()): boolean {
  return berlinYmd(scanTime) === berlinYmd(reference);
}

/** Start des Berlin-Kalendertags als UTC-Date (00:00 Europe/Berlin). */
export function berlinDayStart(reference: Date = new Date()): Date {
  const ymd = berlinYmd(reference);
  const cest = new Date(`${ymd}T00:00:00+02:00`);
  if (berlinYmd(cest) === ymd) return cest;
  return new Date(`${ymd}T00:00:00+01:00`);
}

/** Kalendertag verschieben, ohne über UTC-Mitternacht zu stolpern. */
export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Halboffenes Intervall [start, endExclusive) für den Berlin-Kalendertag. */
export function berlinDayRange(ymd: string): { start: Date; endExclusive: Date } {
  const start = berlinDayStart(new Date(`${ymd}T12:00:00Z`));
  const endExclusive = berlinDayStart(new Date(`${addCalendarDays(ymd, 1)}T12:00:00Z`));
  return { start, endExclusive };
}

/** Stunde 0–23 in Europe/Berlin. */
export function berlinHour(d: Date): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hour12: false,
  }).format(d);
  return Number(raw) % 24;
}

/** "HH:mm" in Europe/Berlin. */
export function berlinHm(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const hour = String(Number(value("hour")) % 24).padStart(2, "0");
  return `${hour}:${value("minute")}`;
}

/** Wochentag als Bit-Index (0=Mo … 6=So), analog zu IrrigationSchedule.daysOfWeek. */
export function berlinWeekdayBit(d: Date = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" })
    .format(d)
    .toLowerCase();
  const map: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  return map[weekday] ?? 0;
}
