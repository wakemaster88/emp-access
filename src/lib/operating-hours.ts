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
  formatHhmm,
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
  /**
   * Zusaetzliche Zeiten, nur fuer Automationen: Unterprofile (Bahnmieten,
   * Kurse) bzw. ihre gebuchten Termine je Kalendertag. Sie werden mit den
   * eigenen Zeiten des Tages zusammengelegt. Anzeigen setzen das nie.
   */
  extra?: ScheduleExtra;
}

export interface ScheduleExtra {
  /** Profile, deren Zeiten voll mitzaehlen. */
  specs?: ScheduleSpec[];
  /** Weitere Spannen je Kalendertag "YYYY-MM-TT", z. B. gebuchte Termine. */
  windows?: Record<string, OpeningWindow[]>;
  /** Anzeige fuer Tage, die nur durch diese Zeiten offen sind. */
  label?: string;
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
  const own = ownOpeningForDay(schedule, ymd);
  const extra = schedule.extra;
  if (!extra) return own;
  const more = [
    ...(extra.specs ?? []).flatMap((spec) => ownOpeningForDay(spec, ymd).windows),
    ...(extra.windows?.[ymd] ?? []),
  ];
  if (more.length === 0) return own;
  const windows = mergeWindows([...own.windows, ...more]);
  return {
    ymd,
    closed: windows.length === 0,
    windows,
    source: own.closed ? "season" : own.source,
    label: own.closed ? (extra.label ?? own.label) : own.label,
  };
}

/** Minuten seit Tagesbeginn als "HH:mm"; ab 24 Uhr am Folgetag. */
function minutesToHhmm(minutes: number): string {
  return formatHhmm(((minutes % 1440) + 1440) % 1440);
}

/**
 * Spannen eines Tages zusammenlegen, wo sie sich beruehren oder ueberlappen
 * (10–12 und 12–16 werden 10–16). Ueber Mitternacht laufende Spannen bleiben
 * erhalten; "durchgehend" (Beginn = Ende) deckt 24 Stunden ab.
 */
export function mergeWindows(windows: OpeningWindow[]): OpeningWindow[] {
  const ranges = windows
    .map((w) => {
      const open = parseHhmm(w.opensAt);
      const close = parseHhmm(w.closesAt);
      if (open == null || close == null) return null;
      const end = close > open ? close : close + 1440;
      return { start: open, end };
    })
    .filter((r): r is { start: number; end: number } => r !== null)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged.map((r) => {
    const close = Math.min(r.end, r.start + 1440) % 1440;
    // Wie `toWindow`: Ende vor Beginn = ueber Mitternacht, gleich = durchgehend.
    return { opensAt: minutesToHhmm(r.start), closesAt: minutesToHhmm(close), overnight: close < r.start };
  });
}

/** Oeffnung eines Tages nur aus Ausnahmetag bzw. Saison, ohne `extra`. */
function ownOpeningForDay(schedule: ScheduleSpec, ymd: string): DayOpening {
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

/**
 * So weit schaut `nextOperatingChange` voraus: gut ein Jahr, damit auch ein
 * Raum, der den ganzen Winter geschlossen ist, seinen Saisonbeginn nennt.
 */
export const NEXT_CHANGE_HORIZON_DAYS = 400;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Versatz der Ortszeit gegen UTC in Minuten zum Zeitpunkt `ms` (volle Minute). */
function offsetMinutes(ms: number, tz: string | null | undefined): number {
  const at = new Date(ms);
  const [y, mo, d] = tzYmd(at, tz).split("-").map(Number);
  return Date.UTC(y, mo - 1, d) / MINUTE_MS + tzMinutesOfDay(at, tz) - Math.floor(ms / MINUTE_MS);
}

/**
 * Erste volle Minute in (`fromMs`, `toMs`], ab der die Uhr einen anderen
 * Versatz gegen UTC hat als zu `fromMs` (Zeitumstellung); null = keine.
 * Annahme wie in der Praxis: hoechstens eine Umstellung je Tag.
 */
function offsetChange(fromMs: number, toMs: number, tz: string | null | undefined): number | null {
  const before = offsetMinutes(fromMs, tz);
  if (offsetMinutes(toMs, tz) === before) return null;
  let lo = Math.floor(fromMs / MINUTE_MS);
  let hi = Math.ceil(toMs / MINUTE_MS);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMinutes(mid * MINUTE_MS, tz) === before) lo = mid;
    else hi = mid;
  }
  return hi * MINUTE_MS;
}

/**
 * Zeitpunkte eines Kalendertags, an denen `isOperatingAt` kippen kann: der
 * Tagesbeginn, Beginn und Ende der eigenen Spannen an diesem Tag und das Ende
 * der Spannen vom Vortag, die in diesen Tag reichen. An einem Tag mit
 * Zeitumstellung kommt deren Zeitpunkt dazu, denn dort springt die Uhrzeit,
 * nach der `isOperatingAt` rechnet. Liegt eine Uhrzeit in der Luecke der
 * Sommerzeit-Umstellung, kommen die Zeitpunkte eine Stunde davor und danach
 * dazu; der genaue Wechsel ergibt sich dann aus `firstChange`. Eine Uhrzeit
 * in der doppelten Stunde am Ende der Sommerzeit gibt es zweimal: Beide
 * Zeitpunkte zaehlen.
 */
function changeCandidates(
  ymd: string,
  today: OpeningWindow[],
  yesterday: OpeningWindow[],
  tz: string | null | undefined,
): number[] {
  const out: number[] = [];
  const add = (hhmm: string) => {
    const at = tzInstant(ymd, hhmm, tz);
    if (!at) return;
    const t = at.getTime();
    out.push(t);
    if (formatHhmm(tzMinutesOfDay(at, tz)) !== hhmm) {
      out.push(t - HOUR_MS, t + HOUR_MS);
      return;
    }
    for (const other of [t - HOUR_MS, t + HOUR_MS]) {
      const o = new Date(other);
      if (tzYmd(o, tz) === ymd && formatHhmm(tzMinutesOfDay(o, tz)) === hhmm) out.push(other);
    }
  };
  const dayStart = tzInstant(ymd, "00:00", tz);
  const nextStart = tzInstant(addDaysToYmd(ymd, 1), "00:00", tz);
  if (dayStart && nextStart && nextStart.getTime() - dayStart.getTime() !== 24 * HOUR_MS) {
    const switchAt = offsetChange(dayStart.getTime(), nextStart.getTime(), tz);
    if (switchAt !== null) out.push(switchAt);
  }
  add("00:00");
  for (const w of today) {
    add(w.opensAt);
    if (!w.overnight && w.opensAt !== w.closesAt) add(w.closesAt);
  }
  for (const w of yesterday) {
    if (w.overnight) add(w.closesAt);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Kann `isOperatingAt` an diesem Kalendertag nicht vom Zustand `state`
 * abweichen? Zu bleibt ein Tag ohne eigene Spanne und ohne Spanne vom Vortag,
 * offen ein durchgehend geoeffneter Tag. Solche Tage ueberspringt die Suche.
 */
function dayKeeps(state: boolean, today: OpeningWindow[], yesterday: OpeningWindow[]): boolean {
  if (state) return today.some((w) => w.opensAt === w.closesAt);
  return today.length === 0 && !yesterday.some((w) => w.overnight);
}

/**
 * Erste volle Minute in (`fromMs`, `toMs`], zu der `isOperatingAt` nicht mehr
 * `state` liefert; zu `toMs` ist das bekannt. Halbierung ueber Minuten, damit
 * der Wechsel auch in der Stunde einer Zeitumstellung stimmt.
 */
function firstChange(schedule: ScheduleSpec, tz: string | null | undefined, state: boolean, fromMs: number, toMs: number): number {
  let lo = Math.floor(fromMs / MINUTE_MS);
  let hi = Math.ceil(toMs / MINUTE_MS);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (isOperatingAt(schedule, new Date(mid * MINUTE_MS), tz) === state) lo = mid;
    else hi = mid;
  }
  return hi * MINUTE_MS;
}

/**
 * Naechster Wechsel offen/zu nach `at`, wie `isOperatingAt` ihn sieht: der
 * erste Zeitpunkt (volle Minute), zu dem es das Gegenteil von jetzt liefert.
 * null = kein Wechsel innerhalb von `horizonDays` Tagen, etwa ein Profil ohne
 * Saison (dauerhaft zu) oder durchgehend geoeffnet; ohne Profil ebenfalls null
 * (immer offen). Saisongrenzen, Ausnahmetage, Spannen ueber Mitternacht und
 * Zeitumstellungen kommen aus derselben Rechnung wie bei `isOperatingAt`.
 * Der Hub haelt damit einen alten Stand bis zum naechsten Wechsel fuer
 * gueltig (hub/src/agent/sentinel-rooms-rules.ts).
 */
export function nextOperatingChange(
  schedule: ScheduleSpec | null | undefined,
  at: Date,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
  horizonDays = NEXT_CHANGE_HORIZON_DAYS,
): Date | null {
  if (!schedule) return null;
  const state = isOperatingAt(schedule, at, tz);
  const atMs = at.getTime();
  let knownMs = atMs;
  const today = tzYmd(at, tz);
  let yesterday = openingForDay(schedule, addDaysToYmd(today, -1)).windows;
  for (let d = 0; d <= horizonDays; d++) {
    const ymd = addDaysToYmd(today, d);
    const windows = openingForDay(schedule, ymd).windows;
    const prev = yesterday;
    yesterday = windows;
    if (dayKeeps(state, windows, prev)) continue;
    for (const c of changeCandidates(ymd, windows, prev, tz)) {
      if (c <= knownMs) continue;
      if (isOperatingAt(schedule, new Date(c), tz) !== state) return new Date(firstChange(schedule, tz, state, knownMs, c));
      knownMs = c;
    }
  }
  return null;
}

/** Eine Oeffnungsspanne als ISO-Zeitpunkte; `to` ausschliesslich. */
export interface OpenSpanIso {
  from: string;
  to: string;
}

/**
 * Oeffnungsspannen zwischen `from` und `to`, wie `isOperatingAt` sie sieht,
 * auf den Zeitraum zugeschnitten. Fuer die Zeile „Heute bewacht“ des Hubs:
 * Er bekommt die Spannen von heute und morgen mit den Raumdaten.
 */
export function openSpansBetween(
  schedule: ScheduleSpec | null | undefined,
  from: Date,
  to: Date,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): OpenSpanIso[] {
  if (to.getTime() <= from.getTime()) return [];
  if (!schedule) return [{ from: from.toISOString(), to: to.toISOString() }];
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const spans: OpenSpanIso[] = [];
  let t = from;
  let open = isOperatingAt(schedule, t, tz);
  while (t.getTime() < to.getTime()) {
    const change = nextOperatingChange(schedule, t, tz, days);
    const end = change && change.getTime() < to.getTime() ? change : to;
    if (open) spans.push({ from: t.toISOString(), to: end.toISOString() });
    if (end === to) break;
    t = end;
    open = !open;
  }
  return spans;
}

/** Versatz an beiden Enden einer Oeffnungsspanne in Minuten; negativ = vorher. */
export interface SpanOffsets {
  openMinutes: number;
  closeMinutes: number;
}

/** Eine Oeffnungsspanne als echte Zeitpunkte, Versatz bereits eingerechnet. */
export interface OperatingSpan {
  from: Date;
  /** Ausschliesslich: um `to` ist die Spanne schon vorbei. */
  to: Date;
  /** Betriebstag "YYYY-MM-TT", zu dem die Spanne gehoert. */
  ymd: string;
}

const NO_OFFSETS: SpanOffsets = { openMinutes: 0, closeMinutes: 0 };

/**
 * Oeffnungsspannen eines Betriebstags als Zeitpunkte, an beiden Enden um
 * `offsets` verschoben. Gebraucht fuer Fenster, die sich an der Betriebszeit
 * ausrichten: "Musik von Betriebsbeginn −30 Min. bis Betriebsende +30 Min.".
 * Eine Spanne ueber Mitternacht endet am Folgetag; gleicher Beginn und
 * gleiches Ende ("durchgehend") dauern 24 Stunden.
 */
export function operatingSpansForDay(
  schedule: ScheduleSpec,
  ymd: string,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
  offsets: SpanOffsets = NO_OFFSETS,
): OperatingSpan[] {
  const out: OperatingSpan[] = [];
  for (const window of openingForDay(schedule, ymd).windows) {
    const from = tzInstant(ymd, window.opensAt, tz);
    const endsNextDay = window.overnight || window.opensAt === window.closesAt;
    const to = tzInstant(endsNextDay ? addDaysToYmd(ymd, 1) : ymd, window.closesAt, tz);
    if (!from || !to) continue;
    out.push({
      from: new Date(from.getTime() + offsets.openMinutes * 60_000),
      to: new Date(to.getTime() + offsets.closeMinutes * 60_000),
      ymd,
    });
  }
  return out;
}

/**
 * Spannen vom Vortag bis `daysAhead` Tage voraus, nach Beginn sortiert und
 * zusammengelegt, wo sie sich beruehren oder ueberlappen: mit Versatz kann
 * die Mittagspause zwischen zwei Spannen verschwinden. Der Vortag reicht,
 * solange der Versatz unter einem Tag bleibt.
 */
function mergedSpansAround(
  schedule: ScheduleSpec,
  at: Date,
  tz: string | null | undefined,
  offsets: SpanOffsets,
  daysAhead: number,
): OperatingSpan[] {
  const today = tzYmd(at, tz);
  const spans: OperatingSpan[] = [];
  for (let offset = -1; offset <= daysAhead; offset++) {
    spans.push(...operatingSpansForDay(schedule, addDaysToYmd(today, offset), tz, offsets));
  }
  spans.sort((a, b) => a.from.getTime() - b.from.getTime());

  const merged: OperatingSpan[] = [];
  for (const span of spans) {
    // Ein Versatz nach innen kann eine kurze Spanne ganz aufzehren.
    if (span.to.getTime() <= span.from.getTime()) continue;
    const last = merged[merged.length - 1];
    if (last && span.from.getTime() <= last.to.getTime()) {
      if (span.to.getTime() > last.to.getTime()) last.to = span.to;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Liegt `at` in einer verschobenen Oeffnungsspanne? Ohne Versatz dasselbe
 * wie `isOperatingAt`, und wie dort gilt ohne Profil: offen.
 */
export function isWithinOperatingSpan(
  schedule: ScheduleSpec | null | undefined,
  at: Date,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
  offsets: SpanOffsets = NO_OFFSETS,
): boolean {
  if (!schedule) return true;
  const ms = at.getTime();
  return mergedSpansAround(schedule, at, tz, offsets, 1).some(
    (span) => ms >= span.from.getTime() && ms < span.to.getTime(),
  );
}

/** Zustand eines Betriebszeit-Fensters samt dem naechsten Wechsel. */
export interface OperatingSpanState {
  /** Liegt der Zeitpunkt im Fenster? */
  inside: boolean;
  /**
   * Wann der Zustand kippt: Ende der laufenden bzw. Beginn der naechsten
   * Spanne. null = kein Wechsel in Sicht (etwa Betriebsferien).
   */
  until: Date | null;
}

/**
 * Drinnen oder draussen, und bis wann. Der Abspieler einer Audio-Zone haelt
 * damit das Fenster auch ohne Verbindung zum Server ein: er kennt den
 * naechsten Wechsel, ohne Saison und Ausnahmetage selbst zu rechnen.
 */
export function operatingSpanState(
  schedule: ScheduleSpec,
  at: Date,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
  offsets: SpanOffsets = NO_OFFSETS,
  daysAhead = 8,
): OperatingSpanState {
  const ms = at.getTime();
  const spans = mergedSpansAround(schedule, at, tz, offsets, daysAhead);
  const current = spans.find((span) => ms >= span.from.getTime() && ms < span.to.getTime());
  if (current) return { inside: true, until: current.to };
  const next = spans.find((span) => span.from.getTime() > ms);
  return { inside: false, until: next?.from ?? null };
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

/**
 * Betriebsbeginn bzw. -ende eines Betriebstags als Zeitpunkt. Bei mehreren
 * Spannen am Tag zaehlt die erste Oeffnung und das letzte Schliessen –
 * "Betriebsbeginn" meint nicht das Ende der Mittagspause.
 */
export function operatingBoundary(
  schedule: ScheduleSpec,
  ymd: string,
  kind: "open" | "close",
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): Date | null {
  const matching = boundariesForDay(schedule, ymd, tz).filter((b) => b.kind === kind);
  const base = kind === "open" ? matching[0] : matching[matching.length - 1];
  return base?.at ?? null;
}

/** Ausloeser, der sich an der Betriebszeit orientiert. */
export interface OperatingTrigger {
  kind: "open" | "close";
  /** Verschiebung in Minuten; negativ = vorher. */
  offsetMinutes: number;
  /**
   * Wochentage als Bitmaske (bit0 = Mo). Gilt fuer den Betriebstag: ein Ende
   * um 02:00 gehoert zum Vortag, an dem der Betrieb geoeffnet hat.
   */
  daysOfWeek: number;
}

/** Ein konkreter Zeitpunkt, den ein Betriebszeit-Ausloeser hervorbringt. */
export interface OperatingOccurrence {
  /** Zeitpunkt einschliesslich Versatz. */
  at: Date;
  /** Betriebstag "YYYY-MM-TT", zu dem der Zeitpunkt gehoert. */
  ymd: string;
}

/** Zeitpunkt des Ausloesers fuer einen Betriebstag, oder null (geschlossen). */
export function operatingOccurrenceForDay(
  schedule: ScheduleSpec,
  trigger: OperatingTrigger,
  ymd: string,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): OperatingOccurrence | null {
  if (((trigger.daysOfWeek >> weekdayBitOfYmd(ymd)) & 1) !== 1) return null;
  const base = operatingBoundary(schedule, ymd, trigger.kind, tz);
  if (!base) return null;
  return { at: new Date(base.getTime() + trigger.offsetMinutes * 60_000), ymd };
}

/**
 * Zeitpunkte des Ausloesers rund um `now`: Vortag, heute und Folgetag, nach
 * Zeit sortiert. Der Vortag ist noetig, weil ein Betriebsende nach
 * Mitternacht zum gestrigen Betriebstag gehoert; der Folgetag, weil ein
 * Versatz vor Mitternacht auf den morgigen Beginn zeigen kann.
 */
function occurrencesAround(
  schedule: ScheduleSpec,
  trigger: OperatingTrigger,
  now: Date,
  tz: string | null | undefined,
  daysAhead: number,
): OperatingOccurrence[] {
  const today = tzYmd(now, tz);
  const out: OperatingOccurrence[] = [];
  for (let offset = -1; offset <= daysAhead; offset++) {
    const occ = operatingOccurrenceForDay(schedule, trigger, addDaysToYmd(today, offset), tz);
    if (occ) out.push(occ);
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Der Zeitpunkt, der jetzt faellig ist: `at - beforeMs <= now < at + afterMs`.
 * Cron-Laeufe kommen nicht sekundengenau; das Fenster faengt Verspaetung ab.
 * Gibt es mehrere Treffer, gewinnt der naechstliegende.
 */
export function dueOperatingOccurrence(
  schedule: ScheduleSpec,
  trigger: OperatingTrigger,
  now: Date,
  tz: string | null | undefined,
  window: { beforeMs: number; afterMs: number },
): OperatingOccurrence | null {
  const nowMs = now.getTime();
  const hits = occurrencesAround(schedule, trigger, now, tz, 1).filter(
    (occ) => nowMs >= occ.at.getTime() - window.beforeMs && nowMs < occ.at.getTime() + window.afterMs,
  );
  if (hits.length === 0) return null;
  return hits.reduce((best, occ) =>
    Math.abs(occ.at.getTime() - nowMs) < Math.abs(best.at.getTime() - nowMs) ? occ : best,
  );
}

/**
 * Der naechste anstehende Zeitpunkt – fuer die Anzeige "heute 20:00". Ein
 * Zeitpunkt gilt noch als anstehend, solange er hoechstens `graceMs`
 * zurueckliegt; so springt die Anzeige nicht auf morgen, waehrend der Termin
 * gerade abgearbeitet wird.
 */
export function nextOperatingOccurrence(
  schedule: ScheduleSpec,
  trigger: OperatingTrigger,
  now: Date,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
  graceMs = 0,
): OperatingOccurrence | null {
  const threshold = now.getTime() - graceMs;
  return occurrencesAround(schedule, trigger, now, tz, 8).find((occ) => occ.at.getTime() >= threshold) ?? null;
}

const WEEKDAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** "heute 20:00", "morgen 09:30" oder "Sa 10:00" – relativ zum Tag von `now`. */
export function describeOccurrence(
  occ: OperatingOccurrence,
  now: Date,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): string {
  return describeInstant(occ.at, now, tz);
}

/** Wie `describeOccurrence`, für einen beliebigen Zeitpunkt. */
export function describeInstant(
  at: Date,
  now: Date,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): string {
  const today = tzYmd(now, tz);
  const day = tzYmd(at, tz);
  const time = formatHhmm(tzMinutesOfDay(at, tz));
  if (day === today) return `heute ${time}`;
  if (day === addDaysToYmd(today, 1)) return `morgen ${time}`;
  return `${WEEKDAY_NAMES[weekdayBitOfYmd(day)]} ${time}`;
}

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
