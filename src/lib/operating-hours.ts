/**
 * Betriebszeiten auswerten: "Haben wir gerade geoeffnet?" und "Wann heute?"
 *
 * Reine Rechenlogik ohne Prisma und ohne Netzwerk, damit sie sich testen laesst
 * und auch Oberflaechen sie importieren koennen. Die Daten kommen als einfache
 * Objekte herein; wer sie laedt, entscheidet der Aufrufer.
 *
 * Regeln der Aufloesung, in dieser Reihenfolge:
 *  1. Gibt es fuer den Kalendertag einen Ausnahmetag, gilt nur dieser.
 *  2. Sonst die erste passende Saison (nach `sortOrder`) und deren Perioden
 *     fuer den Wochentag.
 *  3. Passt keine Saison, ist geschlossen. Ein Profil ohne Saison ist also
 *     dauerhaft zu – das faellt in der Oberflaeche sofort auf und ist ehrlicher
 *     als ein stilles "immer offen".
 *
 * Eine Periode mit `closesAt` vor `opensAt` laeuft ueber Mitternacht. Deshalb
 * schaut `isOperatingAt` immer auch auf den Vortag: um 01:00 kann die Periode
 * von gestern 18:00–02:00 noch laufen.
 */

import {
  DEFAULT_TIMEZONE,
  addDaysToYmd,
  parseHhmm,
  tzInstant,
  tzMinutesOfDay,
  tzYmd,
  weekdayBitOfYmd,
} from "./tz-time";

export interface PeriodSpec {
  /** 0=Mo … 6=So. */
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface SeasonSpec {
  name: string;
  /** "MM-TT", gilt jedes Jahr erneut. */
  startMmDd: string;
  endMmDd: string;
  sortOrder: number;
  periods: PeriodSpec[];
}

export interface ExceptionSpec {
  /** "YYYY-MM-TT". */
  date: string;
  closed: boolean;
  opensAt: string | null;
  closesAt: string | null;
  note?: string | null;
}

export interface ScheduleSpec {
  name: string;
  seasons: SeasonSpec[];
  exceptions: ExceptionSpec[];
}

/** Eine Oeffnungsspanne an einem Tag. */
export interface OpeningWindow {
  opensAt: string;
  closesAt: string;
  /** Die Spanne endet erst am Folgetag (18:00–02:00). */
  overnight: boolean;
}

export interface DayOpening {
  ymd: string;
  closed: boolean;
  windows: OpeningWindow[];
  /** Woher die Angabe stammt – fuer die Anzeige und zur Fehlersuche. */
  source: "exception" | "season" | "none";
  /** Name der greifenden Saison bzw. Notiz des Ausnahmetags. */
  label: string | null;
}

const MMDD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isMmDd(value: string): boolean {
  return MMDD_RE.test(value);
}

/** "YYYY-MM-TT" -> "MM-TT". */
function mmDdOf(ymd: string): string {
  return ymd.slice(5, 10);
}

/**
 * Liegt "MM-TT" im Zeitraum? Ein Ende vor dem Start laeuft ueber den
 * Jahreswechsel: 11-01 bis 03-31 enthaelt den Januar.
 */
export function isWithinSeasonRange(mmDd: string, startMmDd: string, endMmDd: string): boolean {
  if (startMmDd <= endMmDd) return mmDd >= startMmDd && mmDd <= endMmDd;
  return mmDd >= startMmDd || mmDd <= endMmDd;
}

function toWindow(opensAt: string, closesAt: string): OpeningWindow | null {
  const open = parseHhmm(opensAt);
  const close = parseHhmm(closesAt);
  if (open == null || close == null) return null;
  return { opensAt, closesAt, overnight: close < open };
}

/** Die greifende Saison eines Kalendertags, oder `null`. */
export function seasonForDay(schedule: ScheduleSpec, ymd: string): SeasonSpec | null {
  const mmDd = mmDdOf(ymd);
  const matching = schedule.seasons
    .filter((s) => isWithinSeasonRange(mmDd, s.startMmDd, s.endMmDd))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return matching[0] ?? null;
}

/**
 * Oeffnungszeiten eines Kalendertags. `ymd` ist ein Datum in der Zeitzone des
 * Betriebs, nicht UTC.
 */
export function openingForDay(schedule: ScheduleSpec, ymd: string): DayOpening {
  const exception = schedule.exceptions.find((e) => e.date === ymd);
  if (exception) {
    if (exception.closed || !exception.opensAt || !exception.closesAt) {
      return { ymd, closed: true, windows: [], source: "exception", label: exception.note ?? null };
    }
    const window = toWindow(exception.opensAt, exception.closesAt);
    return {
      ymd,
      closed: !window,
      windows: window ? [window] : [],
      source: "exception",
      label: exception.note ?? null,
    };
  }

  const season = seasonForDay(schedule, ymd);
  if (!season) return { ymd, closed: true, windows: [], source: "none", label: null };

  const weekday = weekdayBitOfYmd(ymd);
  const windows = season.periods
    .filter((p) => p.weekday === weekday)
    .map((p) => toWindow(p.opensAt, p.closesAt))
    .filter((w): w is OpeningWindow => w !== null)
    .sort((a, b) => (parseHhmm(a.opensAt) ?? 0) - (parseHhmm(b.opensAt) ?? 0));

  return {
    ymd,
    closed: windows.length === 0,
    windows,
    source: "season",
    label: season.name,
  };
}

/** Deckt die Spanne den Zeitpunkt `minutes` an ihrem Starttag ab? */
function coversSameDay(window: OpeningWindow, minutes: number): boolean {
  const open = parseHhmm(window.opensAt);
  const close = parseHhmm(window.closesAt);
  if (open == null || close == null) return false;
  if (open === close) return true; // durchgehend geoeffnet
  if (window.overnight) return minutes >= open;
  return minutes >= open && minutes < close;
}

/** Reicht die Spanne vom Vortag noch in diesen Zeitpunkt hinein? */
function coversFromPreviousDay(window: OpeningWindow, minutes: number): boolean {
  if (!window.overnight) return false;
  const close = parseHhmm(window.closesAt);
  return close != null && minutes < close;
}

/**
 * Hat der Betrieb zum Zeitpunkt `at` geoeffnet?
 *
 * Beruecksichtigt Spannen ueber Mitternacht, indem auch der Vortag geprueft
 * wird. Ohne Profil (`schedule` = null) gilt der Betrieb als geoeffnet – ein
 * Raum ohne Betriebszeit soll keine Regel blockieren.
 */
export function isOperatingAt(
  schedule: ScheduleSpec | null | undefined,
  at: Date,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): boolean {
  if (!schedule) return true;
  const ymd = tzYmd(at, tz);
  const minutes = tzMinutesOfDay(at, tz);

  const today = openingForDay(schedule, ymd);
  if (today.windows.some((w) => coversSameDay(w, minutes))) return true;

  const yesterday = openingForDay(schedule, addDaysToYmd(ymd, -1));
  return yesterday.windows.some((w) => coversFromPreviousDay(w, minutes));
}

export interface OperatingBoundary {
  /** Zeitpunkt des Betriebsbeginns bzw. -endes. */
  at: Date;
  kind: "open" | "close";
}

/**
 * Betriebsbeginn und -ende eines Kalendertags als echte Zeitpunkte.
 *
 * Die Regel-Engine braucht das fuer Ausloeser wie "30 Minuten vor
 * Betriebsende". Bei einer Spanne ueber Mitternacht liegt das Ende am
 * Folgetag – deshalb echte Zeitpunkte und nicht nur "HH:mm".
 */
export function boundariesForDay(
  schedule: ScheduleSpec,
  ymd: string,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): OperatingBoundary[] {
  const day = openingForDay(schedule, ymd);
  const out: OperatingBoundary[] = [];
  for (const window of day.windows) {
    const opensAt = tzInstant(ymd, window.opensAt, tz);
    if (opensAt) out.push({ at: opensAt, kind: "open" });
    const closeYmd = window.overnight ? addDaysToYmd(ymd, 1) : ymd;
    const closesAt = tzInstant(closeYmd, window.closesAt, tz);
    if (closesAt) out.push({ at: closesAt, kind: "close" });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

const WEEKDAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? "?";
}

/** "10:00–20:00 · 22:00–02:00" bzw. "geschlossen". */
export function describeDay(day: DayOpening): string {
  if (day.closed || day.windows.length === 0) return "geschlossen";
  return day.windows.map((w) => `${w.opensAt}–${w.closesAt}`).join(" · ");
}

/** "01.05.–15.09." aus zwei "MM-TT"-Angaben. */
export function describeSeasonRange(startMmDd: string, endMmDd: string): string {
  const fmt = (mmDd: string) => {
    const [mm, dd] = mmDd.split("-");
    return `${dd}.${mm}.`;
  };
  return `${fmt(startMmDd)}–${fmt(endMmDd)}`;
}
