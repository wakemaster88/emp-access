/**
 * Abgleich der Betriebszeiten mit anny und der Website (Seite /betriebszeiten).
 *
 * Verglichen wird je Kalendertag die Spanne „früheste Öffnung – späteste
 * Schließung“ oder „zu“. Einzelne Lücken innerhalb des Tags zählen nicht: anny
 * nimmt gebuchte Zeiten (SUP, Grillplatz) aus den Öffnungszeiten heraus, das
 * wäre sonst ständig eine Abweichung.
 *
 * Reine Funktionen auf "YYYY-MM-TT"-Strings; Laden passiert in der API-Route.
 */
import { openingForDay, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd, formatHhmm, parseHhmm, tzMinutesOfDay, tzYmd, weekdayBitOfYmd } from "./tz-time";

/** "12:00–16:00" oder "zu". */
export type DayValue = string;
export const CLOSED: DayValue = "zu";

function span(windows: { start: number; end: number }[]): DayValue {
  if (windows.length === 0) return CLOSED;
  const start = Math.min(...windows.map((w) => w.start));
  const end = Math.max(...windows.map((w) => w.end));
  return `${hhmm(start)}–${hhmm(end)}`;
}

/** Wie formatHhmm, aber 24:00 bleibt 24:00 (Tagesende). */
function hhmm(minutes: number): string {
  return minutes >= 24 * 60 ? "24:00" : formatHhmm(minutes);
}

/** Tageswert eines Betriebszeiten-Profils. */
export function scheduleDayValue(spec: ScheduleSpec, ymd: string): DayValue {
  const day = openingForDay(spec, ymd);
  if (day.closed) return CLOSED;
  const windows: { start: number; end: number }[] = [];
  for (const w of day.windows) {
    const start = parseHhmm(w.opensAt);
    const end = parseHhmm(w.closesAt);
    if (start == null || end == null) continue;
    // Über Mitternacht oder durchgehend: bis 24:00 dieses Tags.
    windows.push({ start, end: end <= start ? 24 * 60 : end });
  }
  return span(windows);
}

/**
 * anny-Perioden (ISO-Zeitpunkte) je Tag zusammengefasst. Tage ohne Periode
 * sind in anny geschlossen, solange sie im abgefragten Zeitraum liegen.
 */
export function annyDayValues(
  periods: { start: string; end: string }[],
  tz: string,
): Map<string, DayValue> {
  const byDay = new Map<string, { start: number; end: number }[]>();
  for (const p of periods) {
    const from = new Date(p.start);
    const to = new Date(p.end);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) continue;
    const ymd = tzYmd(from, tz);
    const start = tzMinutesOfDay(from, tz);
    // Endet die Periode an einem späteren Tag, zählt sie an ihrem Starttag bis 24:00.
    const end = tzYmd(to, tz) === ymd ? tzMinutesOfDay(to, tz) : 24 * 60;
    const list = byDay.get(ymd) ?? [];
    list.push({ start, end });
    byDay.set(ymd, list);
  }
  const out = new Map<string, DayValue>();
  for (const [ymd, windows] of byDay) out.set(ymd, span(windows));
  return out;
}

/** Zeilen der Website-Datenbank (Tabellen opening_hours_periods / _dates). */
export interface WebsitePeriodRow {
  validFrom: string;
  validTo: string;
  /** 0 = Sonntag wie in JavaScript; null = jeder Tag. */
  jsDay: number | null;
  timeText: string | null;
  isClosed: boolean;
  priority: number;
}

export interface WebsiteDateRow {
  date: string;
  timeText: string | null;
  isClosed: boolean;
}

/** "12:00 - 18:00" bzw. "12 – 18 Uhr" -> "12:00–18:00"; unlesbar -> null. */
export function parseWebsiteTime(text: string | null): DayValue | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(?:-|–|bis)\s*(\d{1,2})(?::(\d{2}))?/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const end = Number(m[3]) * 60 + Number(m[4] ?? 0);
  if (start > 24 * 60 || end > 24 * 60) return null;
  return span([{ start, end: end <= start ? 24 * 60 : end }]);
}

/**
 * Was die Website-Datenbank für einen Tag sagt: Datumseintrag vor Zeitraum;
 * bei mehreren Zeiträumen gewinnt der mit Wochentag vor dem ohne, dann die
 * höhere Priorität, dann der später beginnende. null = keine Angabe.
 */
export function websiteDayValue(
  periods: WebsitePeriodRow[],
  dates: WebsiteDateRow[],
  ymd: string,
): DayValue | null {
  const date = dates.find((d) => d.date === ymd);
  if (date) return date.isClosed ? CLOSED : parseWebsiteTime(date.timeText);
  const jsDay = (weekdayBitOfYmd(ymd) + 1) % 7;
  const matching = periods
    .filter((p) => p.validFrom <= ymd && ymd <= p.validTo && (p.jsDay == null || p.jsDay === jsDay))
    .sort(
      (a, b) =>
        Number(b.jsDay != null) - Number(a.jsDay != null) ||
        b.priority - a.priority ||
        b.validFrom.localeCompare(a.validFrom),
    );
  const best = matching[0];
  if (!best) return null;
  return best.isClosed ? CLOSED : parseWebsiteTime(best.timeText);
}

export interface DiffGroup {
  /** Wert in emp-access. */
  ours: DayValue;
  /** Wert in anny bzw. auf der Website; null = dort keine Angabe. */
  theirs: DayValue | null;
  first: string;
  last: string;
  days: number;
}

export interface CompareResult {
  /** Verglichene Tage. */
  days: number;
  /** Tage mit Abweichung. */
  differing: number;
  /** Tage, an denen die Gegenseite nichts sagt. */
  missing: number;
  /** Erster Tag mit Abweichung. */
  firstDiff: string | null;
  /** Abweichungen nach gleichem Wertepaar, früheste zuerst. */
  groups: DiffGroup[];
}

/** Tage von `from` bis einschließlich `to`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToYmd(d, 1)) out.push(d);
  return out;
}

/**
 * Tag für Tag vergleichen. `theirs` liefert null für „keine Angabe“; das zählt
 * als Abweichung, außer emp-access hat an dem Tag ebenfalls zu.
 */
export function compareDays(
  days: string[],
  ours: (ymd: string) => DayValue,
  theirs: (ymd: string) => DayValue | null,
  maxGroups = 8,
): CompareResult {
  const groups = new Map<string, DiffGroup>();
  let differing = 0;
  let missing = 0;
  let firstDiff: string | null = null;
  for (const ymd of days) {
    const a = ours(ymd);
    const b = theirs(ymd);
    if (b == null) missing += 1;
    if (a === (b ?? CLOSED)) continue;
    differing += 1;
    firstDiff ??= ymd;
    const key = `${a}|${b ?? ""}`;
    const g = groups.get(key);
    if (g) {
      g.last = ymd;
      g.days += 1;
    } else {
      groups.set(key, { ours: a, theirs: b, first: ymd, last: ymd, days: 1 });
    }
  }
  return {
    days: days.length,
    differing,
    missing,
    firstDiff,
    groups: [...groups.values()].sort((x, y) => x.first.localeCompare(y.first)).slice(0, maxGroups),
  };
}

/** Kleinbuchstaben ohne Umlaute und Sonderzeichen, für den Namensvergleich. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

const LIFT_NAME = /wasserski|wakeboard|seilbahn|lift/i;
const LIFT_SLUGS = ["wakeboard", "wasserski", "wake"];

/**
 * Welche Website-Seite gehört zu einem Profil? Gleicher Name, der eine als
 * Anfang des anderen („gastro“ – „Gastronomie“) oder beim Lift die Wake-Seite.
 */
export function matchWebsiteSlug(profileName: string, slugs: string[]): string | null {
  const name = normalizeName(profileName);
  if (!name) return null;
  const exact = slugs.find((s) => normalizeName(s) === name);
  if (exact) return exact;
  const prefix = slugs.find((s) => {
    const slug = normalizeName(s);
    return slug.length >= 3 && (name.startsWith(slug) || slug.startsWith(name));
  });
  if (prefix) return prefix;
  if (LIFT_NAME.test(profileName)) return slugs.find((s) => LIFT_SLUGS.includes(normalizeName(s))) ?? null;
  return null;
}
