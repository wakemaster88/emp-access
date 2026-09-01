/**
 * Wanduhr-Rechnen in einer IANA-Zeitzone.
 *
 * Auf Vercel laeuft die Runtime in UTC. Alles, was mit "18:00" oder "Montag"
 * arbeitet, muss deshalb explizit umrechnen – `getHours()` liegt sonst je nach
 * Jahreszeit ein oder zwei Stunden daneben.
 *
 * Diese Helfer lagen bisher privat in `shelly-automation.ts`. Mit den
 * Betriebszeiten braucht sie eine zweite Stelle, deshalb stehen sie hier.
 * Ohne Abhaengigkeiten, damit auch Oberflaechen sie importieren koennen.
 *
 * Fuer reine Kalendertags-Fragen in Europe/Berlin gibt es weiterhin
 * `src/lib/berlin-day.ts`; dieses Modul ist die zeitzonenparametrierte Variante.
 */

/** Zeitzone, wenn im Account keine hinterlegt ist. */
export const DEFAULT_TIMEZONE = "Europe/Berlin";

/** Wochentag als Bit-Index, wie ihn `daysOfWeek`-Bitmasken verwenden. */
export type WeekdayBit = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const WEEKDAY_BITS: Record<string, WeekdayBit> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

function zone(tz: string | null | undefined): string {
  return tz || DEFAULT_TIMEZONE;
}

/** "HH:mm" in Minuten seit Mitternacht. `null` bei ungueltiger Eingabe. */
export function parseHhmm(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minuten seit Mitternacht als "HH:mm". */
export function formatHhmm(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minuten seit Mitternacht in der angegebenen Zeitzone. */
export function tzMinutesOfDay(at: Date, tz: string | null | undefined): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone(tz),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  // en-GB liefert fuer Mitternacht teils "24".
  return (h === 24 ? 0 : h) * 60 + m;
}

/** Wochentag als Bit-Index (0=Mo … 6=So) in der angegebenen Zeitzone. */
export function tzWeekdayBit(at: Date, tz: string | null | undefined): WeekdayBit {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zone(tz), weekday: "short" })
    .format(at)
    .toLowerCase();
  return WEEKDAY_BITS[weekday] ?? 0;
}

/** Kalendertag "YYYY-MM-DD" in der angegebenen Zeitzone. */
export function tzYmd(at: Date, tz: string | null | undefined): string {
  return at.toLocaleDateString("sv-SE", { timeZone: zone(tz) });
}

/** Kalendertag verschieben, ohne ueber Monats- und Jahresgrenzen zu stolpern. */
export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Wochentag-Bit eines Kalendertags "YYYY-MM-DD" (zeitzonenunabhaengig). */
export function weekdayBitOfYmd(ymd: string): WeekdayBit {
  const [y, m, d] = ymd.split("-").map(Number);
  // getUTCDay: 0=So … 6=Sa. Wir brauchen 0=Mo … 6=So.
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (((jsDay + 6) % 7) as WeekdayBit);
}

/**
 * Wanduhrzeit an einem bestimmten Kalendertag in einen echten Zeitpunkt
 * uebersetzen: `tzInstant("2026-07-01", "18:00", "Europe/Berlin")` liefert das
 * UTC-Date, das dort 18:00 Ortszeit entspricht.
 *
 * Naeherung ueber Fixpunkt-Iteration: der erste Versuch interpretiert die
 * Angabe als UTC, die Korrektur zieht den Zonen-Versatz ab. Zwei Durchlaeufe
 * genuegen fuer alle Zeitzonen einschliesslich der Sommerzeit-Umstellung.
 */
export function tzInstant(ymd: string, hhmm: string, tz: string | null | undefined): Date | null {
  const minutes = parseHhmm(hhmm);
  if (minutes == null) return null;
  const [y, mo, d] = ymd.split("-").map(Number);
  if (!y || !mo || !d) return null;

  const timeZone = zone(tz);
  const h = Math.floor(minutes / 60);
  const mi = minutes % 60;
  const targetUtc = Date.UTC(y, mo - 1, d, h, mi, 0);

  let guess = new Date(targetUtc);
  for (let i = 0; i < 2; i++) {
    const shown = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(guess);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(shown.find((p) => p.type === type)?.value);
    const shownHour = part("hour");
    const shownUtc = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      shownHour === 24 ? 0 : shownHour,
      part("minute"),
      0,
    );
    const diff = targetUtc - shownUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/**
 * Liegt `at` im Fenster [start, end)? `end` vor `start` bedeutet ueber
 * Mitternacht (22:00–08:00). Gleiche Werte bedeuten "immer".
 */
export function isWithinWindow(
  at: Date,
  start: string,
  end: string,
  tz: string | null | undefined,
): boolean {
  const startM = parseHhmm(start);
  const endM = parseHhmm(end);
  if (startM == null || endM == null) return false;
  const mins = tzMinutesOfDay(at, tz);
  if (startM === endM) return true;
  if (startM < endM) return mins >= startM && mins < endM;
  return mins >= startM || mins < endM;
}
