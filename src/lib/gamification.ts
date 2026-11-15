/**
 * Gamification für Abo-Fahrer: reine Rechenlogik ohne Datenbank.
 *
 * Grundlage sind Tagessummen je Abo-Ticket (`RiderDayStat`): ein Besuchstag ist
 * ein Kalendertag (Europe/Berlin) mit mindestens einem Start, ein Start ist ein
 * GRANTED-Scan an einem Gerät mit `countsAsStart`. Die Datenbank-Seite steht in
 * `gamification-service.ts`.
 */
import { berlinYmd } from "./berlin-day";

export type GamiMetric = "VISIT_DAYS" | "STARTS" | "STREAK_WEEKS";
export type GamiPeriod = "SEASON" | "MONTH";

export const GAMI_METRICS: GamiMetric[] = ["VISIT_DAYS", "STARTS", "STREAK_WEEKS"];
export const GAMI_PERIODS: GamiPeriod[] = ["SEASON", "MONTH"];

export const METRIC_LABEL: Record<GamiMetric, string> = {
  VISIT_DAYS: "Besuchstage",
  STARTS: "Starts",
  STREAK_WEEKS: "Wochen in Serie",
};

export const PERIOD_LABEL: Record<GamiPeriod, string> = {
  SEASON: "Saison",
  MONTH: "Monat",
};

/** Tagessumme: Kalendertag als "YYYY-MM-DD" und die Starts an diesem Tag. */
export interface DayStat {
  day: string;
  starts: number;
}

export interface MilestoneRule {
  id: number;
  metric: GamiMetric;
  threshold: number;
  period: GamiPeriod;
}

export interface Metrics {
  visitDays: number;
  starts: number;
  streakWeeks: number;
}

/** Schlüssel des Zeitraums, in den ein Tag fällt: "2027" (Saison) oder "2027-06" (Monat). */
export function periodKey(period: GamiPeriod, ymd: string): string {
  return period === "MONTH" ? ymd.slice(0, 7) : ymd.slice(0, 4);
}

/** Fortlaufende Wochennummer (Montag bis Sonntag), über Jahresgrenzen hinweg lückenlos. */
export function weekIndex(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  // 1970-01-01 war ein Donnerstag; +3 legt den Wochenwechsel auf Montag.
  return Math.floor((days + 3) / 7);
}

/** Längste Folge aufeinanderfolgender Wochen mit mindestens einem Besuchstag. */
export function longestWeekStreak(days: string[]): number {
  const weeks = [...new Set(days.map(weekIndex))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const w of weeks) {
    run = prev != null && w === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = w;
  }
  return best;
}

/**
 * Laufende Serie zum Stichtag: Wochen in Folge bis zur aktuellen Woche. Die
 * aktuelle Woche darf noch leer sein (die Serie reißt erst, wenn eine ganze
 * Woche ohne Besuch vorbei ist).
 */
export function currentWeekStreak(days: string[], refYmd: string): number {
  const weeks = new Set(days.map(weekIndex));
  let w = weekIndex(refYmd);
  if (!weeks.has(w)) w -= 1;
  let run = 0;
  while (weeks.has(w)) {
    run += 1;
    w -= 1;
  }
  return run;
}

/**
 * Kennzahlen aus Tagessummen. `capPerDay` begrenzt, wie viele Starts eines
 * Tages zählen – damit sich Meilensteine nicht durch Durchdrehen am Drehkreuz
 * erreichen lassen.
 */
export function computeMetrics(days: DayStat[], capPerDay: number): Metrics {
  const visited = days.filter((d) => d.starts > 0);
  const cap = capPerDay > 0 ? capPerDay : Number.POSITIVE_INFINITY;
  return {
    visitDays: visited.length,
    starts: visited.reduce((sum, d) => sum + Math.min(d.starts, cap), 0),
    streakWeeks: longestWeekStreak(visited.map((d) => d.day)),
  };
}

export function metricValue(metrics: Metrics, metric: GamiMetric): number {
  if (metric === "VISIT_DAYS") return metrics.visitDays;
  if (metric === "STARTS") return metrics.starts;
  return metrics.streakWeeks;
}

/** Schlüssel, unter dem ein vergebener Meilenstein gemerkt wird. */
export function awardKey(milestoneId: number, key: string): string {
  return `${milestoneId}:${key}`;
}

/**
 * Welche Meilensteine sind zum Stichtag erreicht und noch nicht vergeben?
 *
 * `days` enthält die Tagessummen des Tickets (mindestens die der laufenden
 * Saison); gezählt wird je Meilenstein nur der Zeitraum, in dem der Stichtag
 * liegt.
 */
export function reachedMilestones(
  milestones: MilestoneRule[],
  days: DayStat[],
  refYmd: string,
  capPerDay: number,
  awarded: ReadonlySet<string>,
): Array<{ milestoneId: number; periodKey: string }> {
  const out: Array<{ milestoneId: number; periodKey: string }> = [];
  const cache = new Map<string, Metrics>();
  for (const m of milestones) {
    if (m.threshold <= 0) continue;
    const key = periodKey(m.period, refYmd);
    if (awarded.has(awardKey(m.id, key))) continue;
    let metrics = cache.get(key);
    if (!metrics) {
      metrics = computeMetrics(days.filter((d) => d.day.startsWith(key)), capPerDay);
      cache.set(key, metrics);
    }
    if (metricValue(metrics, m.metric) >= m.threshold) {
      out.push({ milestoneId: m.id, periodKey: key });
    }
  }
  return out;
}

export interface AggregatedDay {
  ticketId: number;
  day: string;
  starts: number;
  firstStartAt: Date;
  lastStartAt: Date;
}

/** Start-Scans zu Tagessummen je Ticket verdichten (für die Rückrechnung). */
export function aggregateScans(scans: Array<{ ticketId: number; scanTime: Date }>): AggregatedDay[] {
  const map = new Map<string, AggregatedDay>();
  for (const s of scans) {
    const day = berlinYmd(s.scanTime);
    const key = `${s.ticketId}:${day}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ticketId: s.ticketId, day, starts: 1, firstStartAt: s.scanTime, lastStartAt: s.scanTime });
      continue;
    }
    cur.starts += 1;
    if (s.scanTime < cur.firstStartAt) cur.firstStartAt = s.scanTime;
    if (s.scanTime > cur.lastStartAt) cur.lastStartAt = s.scanTime;
  }
  return [...map.values()];
}

/** Kalendertag als Date für eine `@db.Date`-Spalte (UTC-Mitternacht). */
export function ymdToDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** `@db.Date`-Wert zurück nach "YYYY-MM-DD". */
export function dbDateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Bedingung eines Meilensteins in Worten, z. B. "10 Besuchstage · Saison". */
export function milestoneConditionText(m: { metric: GamiMetric; threshold: number; period: GamiPeriod }): string {
  return `${m.threshold} ${METRIC_LABEL[m.metric]} · ${PERIOD_LABEL[m.period]}`;
}

export type BenefitVoucherState = "open" | "redeemed" | "expired" | "disabled";

/** Zustand eines Leistungs-Gutscheins zum Zeitpunkt `now`. */
export function benefitVoucherState(
  v: { redeemedAt: Date | null; disabledAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): BenefitVoucherState {
  if (v.redeemedAt) return "redeemed";
  if (v.disabledAt) return "disabled";
  if (v.expiresAt && v.expiresAt.getTime() < now.getTime()) return "expired";
  return "open";
}

export const BENEFIT_STATE_MESSAGE: Record<Exclude<BenefitVoucherState, "open">, string> = {
  redeemed: "Gutschein bereits eingelöst",
  expired: "Gutschein abgelaufen",
  disabled: "Gutschein wurde deaktiviert",
};
