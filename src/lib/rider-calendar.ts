/**
 * Öffnungszeiten-Kalender der Kunden-App (`/app/<token>/zeiten`): ein Monat
 * eines Betriebszeiten-Profils, als Raster und als Liste der offenen Tage.
 *
 * Reine Funktionen auf "YYYY-MM-TT" (Kalendertage in Europe/Berlin), ohne
 * Datenbank, damit sie sich testen lassen. Geladen wird in rider-opening.ts.
 */
import { openingForDay, type ScheduleSpec } from "./operating-hours";
import { addMonthsToYmd, firstOfMonth, monthGrid, monthTitle } from "./operating-calendar";

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** So weit kann man im Kalender blättern: ein Monat zurück, zwölf voraus. */
export const CALENDAR_MONTHS_BACK = 1;
export const CALENDAR_MONTHS_AHEAD = 12;

/** "12:00" -> "12", "12:30" -> "12:30". */
export function shortTime(hhmm: string): string {
  return hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : hhmm.replace(/^0/, "");
}

export interface CalendarDay {
  ymd: string;
  /** Tag gehört zum gezeigten Monat (sonst Rand aus dem Nachbarmonat). */
  inMonth: boolean;
  open: boolean;
  /** "12–16" bzw. "10–13 und 15–19"; null, wenn geschlossen. */
  hours: string | null;
  /** Ausnahmetag (abweichende Zeit oder zu), mit Notiz wie „Nikolaus“. */
  exception: boolean;
  note: string | null;
  today: boolean;
  past: boolean;
}

export interface CalendarMonth {
  /** "2026-11". */
  key: string;
  title: string;
  weeks: CalendarDay[][];
  /** Tage des Monats, die offen sind oder eine Ausnahme haben, ab heute (vergangene Monate: alle). */
  list: CalendarDay[];
  prev: string | null;
  next: string | null;
}

/** "Sa, 21.11." */
export function calendarDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${WEEKDAY_SHORT[wd]}, ${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.`;
}

/** "2026-12" aus `?monat=`; ungültig oder außerhalb des Blätterbereichs: der Monat von heute. */
export function calendarMonthKey(wanted: string | undefined, today: string): string {
  const current = today.slice(0, 7);
  if (!wanted || !/^\d{4}-(0[1-9]|1[0-2])$/.test(wanted)) return current;
  const min = addMonthsToYmd(today, -CALENDAR_MONTHS_BACK).slice(0, 7);
  const max = addMonthsToYmd(today, CALENDAR_MONTHS_AHEAD).slice(0, 7);
  return wanted < min || wanted > max ? current : wanted;
}

export function calendarMonth(schedule: ScheduleSpec, monthKey: string, today: string): CalendarMonth {
  const first = firstOfMonth(`${monthKey}-01`);
  const day = (ymd: string): CalendarDay => {
    const o = openingForDay(schedule, ymd);
    const open = !o.closed && o.windows.length > 0;
    return {
      ymd,
      inMonth: ymd.slice(0, 7) === monthKey,
      open,
      hours: open ? o.windows.map((w) => `${shortTime(w.opensAt)}–${shortTime(w.closesAt)}`).join(" und ") : null,
      exception: o.source === "exception",
      note: o.source === "exception" ? o.label : null,
      today: ymd === today,
      past: ymd < today,
    };
  };
  const weeks = monthGrid(first).map((w) => w.map(day));
  const list = weeks
    .flat()
    .filter((d) => d.inMonth && (d.open || d.exception) && (!d.past || monthKey < today.slice(0, 7)));
  const prev = addMonthsToYmd(first, -1).slice(0, 7);
  const next = addMonthsToYmd(first, 1).slice(0, 7);
  return {
    key: monthKey,
    title: monthTitle(first),
    weeks,
    list,
    prev: calendarMonthKey(prev, today) === prev ? prev : null,
    next: calendarMonthKey(next, today) === next ? next : null,
  };
}
