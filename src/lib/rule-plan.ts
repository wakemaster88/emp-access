/**
 * Erlaubte Zeitraeume fuer den Plan des Hubs (`buildHubRulePlan` in
 * room-rules.ts), ohne jede Minute abzutasten.
 *
 * Die Bedingungen einer Regel (Wochentag, Zeitfenster, Betriebszeit,
 * Dunkelheit, `ruleAllows`) koennen nur an wenigen Stellen kippen: um
 * Mitternacht, zu Beginn und Ende des Zeitfensters, an den Wechseln der
 * Betriebszeit, bei Sonnenauf- und -untergang, beim Tageswechsel in UTC (die
 * Sonnenzeiten gelten fuer den UTC-Tag) und an einer Zeitumstellung. Nur dort
 * wird ausgewertet (`conditionChangePoints`); dazwischen bleibt das Ergebnis
 * gleich.
 *
 * `rasterIntervals` gibt daraus dieselben Zeitraeume aus wie das fruehere
 * Abtasten im Zwei-Minuten-Raster ab `from`: Ein Zeitraum beginnt an der
 * ersten Rasterstelle, an der die Bedingungen gelten, und endet an der ersten,
 * an der sie nicht mehr gelten. Der Hub prueft damit unveraendert
 * (hub/src/rule-plan-rules.ts, `inAllowed`).
 *
 * Rein, ohne Datenbank.
 */

import { getSunTimesForAccount } from "./sun";
import { openSpansBetween, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd, parseHhmm, tzInstant, tzMinutesOfDay, tzYmd } from "./tz-time";

/** Raster der erlaubten Zeitraeume im Plan, wie seit jeher. */
export const PLAN_STEP_MS = 2 * 60_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Zeitraum [from, to] in ISO-Strings. */
export interface PlanInterval {
  from: string;
  to: string;
}

/** Was die Wechselstellen einer Regel bestimmt. */
export interface PlanConditions {
  operating: "ANY" | "OPEN" | "CLOSED";
  windowStart: string | null;
  windowEnd: string | null;
  onlyWhenDark: boolean;
}

export interface PlanEnv {
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  schedule: ScheduleSpec | null;
}

/** Versatz der Ortszeit gegen UTC in Minuten zur vollen Minute `ms`. */
function offsetMinutes(ms: number, tz: string): number {
  const at = new Date(ms);
  const [y, mo, d] = tzYmd(at, tz).split("-").map(Number);
  return Date.UTC(y, mo - 1, d) / MINUTE_MS + tzMinutesOfDay(at, tz) - Math.floor(ms / MINUTE_MS);
}

/**
 * Erste volle Minute in (`fromMs`, `toMs`] mit anderem Versatz gegen UTC als
 * zu `fromMs` (Zeitumstellung); null = keine. Hoechstens eine je Tag.
 */
function offsetSwitch(fromMs: number, toMs: number, tz: string): number | null {
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

/** Moegliche Abstaende zweier gleicher Uhrzeiten an einem Tag (Zeitumstellung um 1 Std. oder 30 Min.). */
const SAME_CLOCK_SHIFTS = [-HOUR_MS, -HOUR_MS / 2, 0, HOUR_MS / 2, HOUR_MS];

/**
 * Alle Zeitpunkte, zu denen die Uhr am Kalendertag `ymd` auf `hhmm` springt:
 * einer an gewoehnlichen Tagen, zwei in der doppelten Stunde am Ende der
 * Sommerzeit. Liegt die Uhrzeit in der Luecke zum Beginn der Sommerzeit, gibt
 * es sie nicht; der Wechsel liegt dann auf der Zeitumstellung, die
 * `conditionChangePoints` eigens aufnimmt. `switching`: Der Tag hat eine
 * Zeitumstellung; nur dann wird nach einer zweiten Stelle gesucht.
 */
function localTimeInstants(ymd: string, hhmm: string, tz: string, switching: boolean): number[] {
  const minutes = parseHhmm(hhmm);
  const at = tzInstant(ymd, hhmm, tz);
  if (minutes == null || !at) return [];
  if (!switching) return [at.getTime()];
  const out: number[] = [];
  for (const shift of SAME_CLOCK_SHIFTS) {
    const o = new Date(at.getTime() + shift);
    if (tzYmd(o, tz) === ymd && tzMinutesOfDay(o, tz) === minutes) out.push(o.getTime());
  }
  return out;
}

/**
 * Zeitpunkte in (`from`, `end`], an denen `ruleAllows` fuer eine Regel mit
 * diesen Bedingungen kippen kann, aufsteigend und ohne Doppelte. Zwischen
 * zwei Stellen aendert sich das Ergebnis nicht:
 *
 *  - Wochentag: Mitternacht Ortszeit, bei einem Fenster ueber Mitternacht
 *    zusaetzlich dessen Ende (`windowWeekday`).
 *  - Zeitfenster: Beginn und Ende, je Tag, in Ortszeit auf die Minute.
 *  - Zeitumstellung: die Uhr springt, also auch Fenster und Wochentag.
 *  - Betriebszeit (nur bei „waehrend“ bzw. „ausserhalb“): Beginn und Ende
 *    jeder Oeffnungsspanne, wie `isOperatingAt` sie sieht (`openSpansBetween`).
 *  - Dunkelheit: Sonnenaufgang, die Millisekunde nach Sonnenuntergang und
 *    Mitternacht UTC, denn `isDark` nimmt die Sonnenzeiten des UTC-Tags.
 */
export function conditionChangePoints(rule: PlanConditions, env: PlanEnv, from: Date, end: Date): number[] {
  const tz = env.timezone;
  const fromMs = from.getTime();
  const endMs = end.getTime();
  const points: number[] = [];

  const firstDay = addDaysToYmd(tzYmd(from, tz), -1);
  const days = Math.ceil((endMs - fromMs) / DAY_MS) + 3;
  const times = ["00:00"];
  if (rule.windowStart && rule.windowEnd) times.push(rule.windowStart, rule.windowEnd);
  for (let d = 0; d < days; d++) {
    const ymd = addDaysToYmd(firstDay, d);
    const start = tzInstant(ymd, "00:00", tz);
    const next = tzInstant(addDaysToYmd(ymd, 1), "00:00", tz);
    const sw = start && next ? offsetSwitch(start.getTime() - HOUR_MS, next.getTime() + HOUR_MS, tz) : null;
    if (sw !== null) points.push(sw);
    for (const hhmm of times) points.push(...localTimeInstants(ymd, hhmm, tz, sw !== null));
  }

  if (rule.operating !== "ANY" && env.schedule) {
    for (const span of openSpansBetween(env.schedule, from, end, tz)) {
      points.push(Date.parse(span.from), Date.parse(span.to));
    }
  }

  if (rule.onlyWhenDark) {
    const firstUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) - DAY_MS;
    for (let day = firstUtc; day <= endMs + DAY_MS; day += DAY_MS) {
      points.push(day);
      const sun = getSunTimesForAccount(env.latitude, env.longitude, new Date(day + 12 * HOUR_MS));
      if (sun.sunrise) points.push(sun.sunrise.getTime());
      // isDark: dunkel erst nach dem Sonnenuntergang (`now > sunset`).
      if (sun.sunset) points.push(sun.sunset.getTime() + 1);
    }
  }

  return [...new Set(points)].filter((t) => t > fromMs && t <= endMs).sort((a, b) => a - b);
}

/**
 * Zeitraeume im Raster `step` ab `from`, wie das fruehere Abtasten: `points`
 * sind aufsteigende Zeitpunkte ab `from` (der erste ist `from`) mit dem
 * Ergebnis, das bis zum naechsten Zeitpunkt gilt; der letzte gilt bis
 * einschliesslich `end`. Ein Zeitraum beginnt an der ersten Rasterstelle mit
 * `ok` und endet an der ersten ohne, sonst mit `end`.
 */
export function rasterIntervals(
  points: Array<{ at: number; ok: boolean }>,
  from: number,
  end: number,
  step = PLAN_STEP_MS,
): PlanInterval[] {
  const samples = Math.floor((end - from) / step) + 1;
  const iso = (t: number) => new Date(t).toISOString();
  const out: PlanInterval[] = [];
  let open: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const a = Math.max(0, Math.ceil((points[i].at - from) / step));
    const b = i + 1 < points.length ? Math.min(samples, Math.ceil((points[i + 1].at - from) / step)) : samples;
    // Keine Rasterstelle in diesem Abschnitt: Das Abtasten haette ihn nicht gesehen.
    if (b <= a) continue;
    if (points[i].ok && open === null) open = a;
    if (!points[i].ok && open !== null) {
      out.push({ from: iso(from + open * step), to: iso(from + a * step) });
      open = null;
    }
  }
  if (open !== null) out.push({ from: iso(from + open * step), to: iso(end) });
  return out;
}

/**
 * Zeitraeume ohne Raster: `points` wie bei `rasterIntervals`, jeder Abschnitt
 * gilt von seinem Zeitpunkt bis vor den naechsten, der letzte bis `end`.
 * Halboffen [from, to). Fuer Bewegungs-Regeln, die der Hub direkt ausfuehrt
 * (rule-executor.ts): Er entscheidet damit zu jeder Millisekunde wie
 * `ruleAllows` in der Cloud.
 */
export function exactIntervals(points: Array<{ at: number; ok: boolean }>, end: number): PlanInterval[] {
  const iso = (t: number) => new Date(t).toISOString();
  const out: PlanInterval[] = [];
  let open: number | null = null;
  for (const p of points) {
    if (p.at >= end) break;
    if (p.ok && open === null) open = p.at;
    if (!p.ok && open !== null) {
      out.push({ from: iso(open), to: iso(p.at) });
      open = null;
    }
  }
  if (open !== null) out.push({ from: iso(open), to: iso(end) });
  return out;
}
