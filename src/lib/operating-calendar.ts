/**
 * Kalenderansicht der Betriebszeiten: welche Tage ein Monat oder eine Woche
 * zeigt und welche Stunden eines Tages ein Profil geoeffnet hat.
 *
 * Reine Funktionen auf "YYYY-MM-TT"-Strings (Kalendertage in der Zeitzone des
 * Betriebs), damit Server und Browser dieselben Tage sehen.
 */
import { openingForDay, type DayOpening, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd, parseHhmm, weekdayBitOfYmd } from "./tz-time";

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const DAY_MINUTES = 24 * 60;

/** Montag der Woche, in der `ymd` liegt. */
export function mondayOf(ymd: string): string {
  return addDaysToYmd(ymd, -weekdayBitOfYmd(ymd));
}

/** Die sieben Tage (Mo–So) der Woche von `ymd`. */
export function weekDays(ymd: string): string[] {
  const monday = mondayOf(ymd);
  return Array.from({ length: 7 }, (_, i) => addDaysToYmd(monday, i));
}

/** Erster Tag des Monats von `ymd`. */
export function firstOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** Erster Tag des Monats `delta` Monate vor bzw. nach dem von `ymd`. */
export function addMonthsToYmd(ymd: string, delta: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Monatsraster ab Montag: volle Wochen, die den Monat von `ymd` abdecken
 * (vier bis sechs Zeilen). Tage aus Nachbarmonaten fuellen die Raender.
 */
export function monthGrid(ymd: string): string[][] {
  const first = firstOfMonth(ymd);
  const nextFirst = addMonthsToYmd(first, 1);
  const weeks: string[][] = [];
  let monday = mondayOf(first);
  while (monday < nextFirst) {
    weeks.push(weekDays(monday));
    monday = addDaysToYmd(monday, 7);
  }
  return weeks;
}

/** "November 2026". */
export function monthTitle(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? "?"} ${y}`;
}

/** Kalenderwoche nach ISO 8601. */
export function isoWeek(ymd: string): number {
  // Donnerstag derselben Woche bestimmt das Jahr der Woche.
  const thursday = addDaysToYmd(mondayOf(ymd), 3);
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  const dayOfYear = Math.round(
    (Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${jan1}T00:00:00Z`)) / 86_400_000,
  );
  return Math.floor(dayOfYear / 7) + 1;
}

/** "KW 47 · 16.11.–22.11.2026". */
export function weekTitle(ymd: string): string {
  const days = weekDays(ymd);
  const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
  return `KW ${isoWeek(ymd)} · ${fmt(days[0])}–${fmt(days[6])}${days[6].slice(0, 4)}`;
}

/** "Fr, 20.11." */
export function shortDayLabel(ymd: string): string {
  const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  return `${names[weekdayBitOfYmd(ymd)]}, ${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.`;
}

/** Geoeffnete Spanne innerhalb eines Kalendertags, in Minuten ab 0:00. */
export interface DaySegment {
  start: number;
  end: number;
}

function windowSegments(day: DayOpening): DaySegment[] {
  const segments: DaySegment[] = [];
  for (const w of day.windows) {
    const open = parseHhmm(w.opensAt);
    const close = parseHhmm(w.closesAt);
    if (open == null || close == null) continue;
    if (open === close) segments.push({ start: 0, end: DAY_MINUTES });
    else if (w.overnight) segments.push({ start: open, end: DAY_MINUTES });
    else segments.push({ start: open, end: close });
  }
  return segments;
}

/**
 * Geoeffnete Spannen eines Tags fuer die Zeitleiste. Eine Spanne ueber
 * Mitternacht endet am Starttag um 24:00 und erscheint am Folgetag ab 0:00.
 */
export function daySegments(schedule: ScheduleSpec, ymd: string): DaySegment[] {
  const segments = windowSegments(openingForDay(schedule, ymd));
  const previous = openingForDay(schedule, addDaysToYmd(ymd, -1));
  for (const w of previous.windows) {
    if (!w.overnight) continue;
    const close = parseHhmm(w.closesAt);
    if (close != null && close > 0) segments.push({ start: 0, end: close });
  }
  return segments.sort((a, b) => a.start - b.start);
}

/**
 * Stundenbereich der Zeitleiste: von der fruehesten Oeffnung bis zur spaetesten
 * Schliessung, auf volle Stunden gerundet. Ohne Oeffnung 8–20 Uhr.
 */
export function hourRange(segments: DaySegment[]): { from: number; to: number } {
  if (segments.length === 0) return { from: 8, to: 20 };
  const from = Math.floor(Math.min(...segments.map((s) => s.start)) / 60);
  const to = Math.ceil(Math.max(...segments.map((s) => s.end)) / 60);
  return to - from < 4 ? { from: Math.max(0, from - 1), to: Math.min(24, Math.max(to, from + 4)) } : { from, to };
}

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** "12:00" -> "12", "12:30" -> "12:30": kurze Zeiten für enge Zellen. */
export function compactTime(hhmm: string): string {
  return hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : hhmm.replace(/^0/, "");
}

/** "12–16", "10–13, 15–20", "24 h" oder "zu". */
export function compactHours(day: DayOpening): string {
  if (day.closed || day.windows.length === 0) return "zu";
  return day.windows
    .map((w) => (w.opensAt === w.closesAt ? "24 h" : `${compactTime(w.opensAt)}–${compactTime(w.closesAt)}`))
    .join(", ");
}

/** Wochentage als "Sa/So", "Di–Fr" oder "Mo, Mi". */
function dayList(days: number[]): string {
  const runs: number[][] = [];
  for (const d of [...days].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) =>
      r.length === 1
        ? WEEKDAY_SHORT[r[0]]
        : r.length === 2
          ? `${WEEKDAY_SHORT[r[0]]}/${WEEKDAY_SHORT[r[1]]}`
          : `${WEEKDAY_SHORT[r[0]]}–${WEEKDAY_SHORT[r[r.length - 1]]}`,
    )
    .join(", ");
}

/**
 * Wochenplan einer Saison in einer Zeile: Tage mit gleichen Zeiten zusammen,
 * z. B. "Di–Fr 16–20 · Sa/So 12–20" oder "täglich 10–20".
 */
export function describeWeekPlan(periods: { weekday: number; opensAt: string; closesAt: string }[]): string {
  const byDay = new Map<number, string>();
  for (let d = 0; d < 7; d += 1) {
    const windows = periods
      .filter((p) => p.weekday === d)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map((p) => (p.opensAt === p.closesAt ? "24 h" : `${compactTime(p.opensAt)}–${compactTime(p.closesAt)}`));
    if (windows.length > 0) byDay.set(d, windows.join(", "));
  }
  if (byDay.size === 0) return "geschlossen";
  const groups = new Map<string, number[]>();
  for (const [d, hours] of byDay) groups.set(hours, [...(groups.get(hours) ?? []), d]);
  if (groups.size === 1 && byDay.size === 7) return `täglich ${[...groups.keys()][0]}`;
  return [...groups.entries()]
    .sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]))
    .map(([hours, days]) => `${dayList(days)} ${hours}`)
    .join(" · ");
}

/** Bereiche eines Tags mit gleichen Zeiten. */
export interface HoursGroup<T> {
  hours: string;
  /** Mindestens ein Bereich hat an dem Tag einen Ausnahmetag. */
  exception: boolean;
  members: T[];
}

/**
 * Bereiche eines Tags nach gleichen Zeiten zusammengefasst, früheste Öffnung
 * zuerst. Geschlossene Bereiche fallen weg, außer ein Ausnahmetag schließt sie
 * („zu“). Ausnahmetage bilden eigene Gruppen, damit die Markierung stimmt.
 */
export function groupByHours<T>(entries: { item: T; day: DayOpening }[]): HoursGroup<T>[] {
  const groups = new Map<string, HoursGroup<T> & { sort: number }>();
  for (const { item, day } of entries) {
    const exception = day.source === "exception";
    if (day.closed && !exception) continue;
    const hours = compactHours(day);
    const key = `${hours}|${exception ? 1 : 0}`;
    const g = groups.get(key);
    if (g) g.members.push(item);
    else {
      const first = day.windows[0];
      const sort = day.closed || !first ? 24 * 60 * 2 : (parseHhmm(first.opensAt) ?? 0) * 2 + (exception ? 1 : 0);
      groups.set(key, { hours, exception, members: [item], sort });
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.sort - b.sort || a.hours.localeCompare(b.hours))
    .map(({ hours, exception, members }) => ({ hours, exception, members }));
}

/**
 * Namen einer Gruppe kurz: "alle", "alle außer Wasserski" oder die Namen.
 * `all` sind alle gezeigten Bereiche in ihrer Reihenfolge.
 */
export function membersLabel(names: string[], all: string[]): string {
  if (all.length > 1 && names.length === all.length) return "alle";
  const rest = all.filter((n) => !names.includes(n));
  if (names.length >= 3 && rest.length <= 2 && rest.length < names.length) return `alle außer ${rest.join(", ")}`;
  return names.join(", ");
}
