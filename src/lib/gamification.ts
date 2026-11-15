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

/**
 * Tagessummen mehrerer Tickets derselben Person zusammenlegen (Kunden-App):
 * derselbe Kalendertag zählt einmal, die Starts werden addiert.
 */
export function mergeDayStats(days: DayStat[]): DayStat[] {
  const byDay = new Map<string, number>();
  for (const d of days) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.starts);
  return [...byDay.entries()]
    .map(([day, starts]) => ({ day, starts }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface MilestoneProgress {
  id: number;
  name: string;
  metric: GamiMetric;
  period: GamiPeriod;
  threshold: number;
  value: number;
  reached: boolean;
  voucherLabel: string | null;
}

/** Fortschritt je Meilenstein zum Stichtag, in der Reihenfolge der Eingabe. */
export function milestoneProgress(
  milestones: Array<MilestoneRule & { name: string; voucherLabel: string | null }>,
  days: DayStat[],
  refYmd: string,
  capPerDay: number,
): MilestoneProgress[] {
  return milestones.map((m) => {
    const key = periodKey(m.period, refYmd);
    const metrics = computeMetrics(days.filter((d) => d.day.startsWith(key)), capPerDay);
    const value = metricValue(metrics, m.metric);
    return {
      id: m.id,
      name: m.name,
      metric: m.metric,
      period: m.period,
      threshold: m.threshold,
      value: Math.min(value, m.threshold),
      reached: value >= m.threshold,
      voucherLabel: m.voucherLabel,
    };
  });
}

/**
 * Stufe in der Saison: höchster erreichter Besuchstage-Meilenstein und der
 * nächste darüber. Grundlage für „Stammfahrer · noch 8 bis Local“.
 */
export function seasonLevel(progress: MilestoneProgress[]): {
  current: MilestoneProgress | null;
  next: MilestoneProgress | null;
} {
  const ladder = progress
    .filter((p) => p.metric === "VISIT_DAYS" && p.period === "SEASON")
    .sort((a, b) => a.threshold - b.threshold);
  const reached = ladder.filter((p) => p.reached);
  return {
    current: reached.length ? reached[reached.length - 1] : null,
    next: ladder.find((p) => !p.reached) ?? null,
  };
}

/** Geburtsdatum aus dem Formular ("YYYY-MM-DD") gegen das am Ticket gespeicherte prüfen. */
export function sameBirthDate(stored: Date | null, input: string): boolean {
  if (!stored || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  // Am Ticket liegt Mitternacht, je nach Erfassung in UTC oder Berliner Zeit.
  return stored.toISOString().slice(0, 10) === input || berlinYmd(stored) === input;
}

/** Spitzname säubern: Leerraum kürzen, höchstens 20 Zeichen, leer wird null. */
export function cleanNickname(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
  return s.length > 0 ? s : null;
}

export type ChallengeKind = "TASK" | "TOP_X";

export const CHALLENGE_KIND_LABEL: Record<ChallengeKind, string> = {
  TASK: "Aufgabe erfüllt",
  TOP_X: "Top X",
};

export type ChallengePhase = "upcoming" | "running" | "ended";

/** Phase einer Challenge am Tag `todayYmd`; Start- und Endtag zählen mit. */
export function challengePhase(c: { startYmd: string; endYmd: string }, todayYmd: string): ChallengePhase {
  if (todayYmd < c.startYmd) return "upcoming";
  if (todayYmd > c.endYmd) return "ended";
  return "running";
}

/** Wert einer Kennzahl im Zeitraum einer Challenge (beide Tage einschließlich). */
export function challengeValue(
  days: DayStat[],
  c: { metric: GamiMetric; startYmd: string; endYmd: string },
  capPerDay: number,
): number {
  const inRange = days.filter((d) => d.day >= c.startYmd && d.day <= c.endYmd);
  return metricValue(computeMetrics(inRange, capPerDay), c.metric);
}

export interface Standing<K> {
  key: K;
  value: number;
  /** Platz; bei Gleichstand teilen sich mehrere denselben Platz (1, 2, 2, 4). */
  rank: number;
  winner: boolean;
}

/**
 * Rangliste einer Top-X-Challenge. Gewinner ist, wer auf Platz 1 bis
 * `topCount` steht und mindestens 1 erreicht hat – bei Gleichstand auf dem
 * letzten Gewinnerplatz gewinnen alle Gleichauf-Liegenden.
 */
export function rankStandings<K>(entries: Array<{ key: K; value: number }>, topCount: number): Standing<K>[] {
  const sorted = entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
  let rank = 0;
  return sorted.map((e, i) => {
    if (i === 0 || e.value !== sorted[i - 1].value) rank = i + 1;
    return { key: e.key, value: e.value, rank, winner: rank <= topCount };
  });
}

/** Bedingung einer Challenge in Worten. */
export function challengeConditionText(c: {
  kind: ChallengeKind;
  metric: GamiMetric;
  threshold: number | null;
  topCount: number | null;
}): string {
  return c.kind === "TASK"
    ? `${c.threshold ?? 0} ${METRIC_LABEL[c.metric]}`
    : `Top ${c.topCount ?? 0} nach ${METRIC_LABEL[c.metric]}`;
}

/** Ist ein Angebot am Tag `todayYmd` sichtbar? */
export function offerVisible(
  o: { active: boolean; fromYmd: string | null; toYmd: string | null },
  todayYmd: string,
): boolean {
  if (!o.active) return false;
  if (o.fromYmd && todayYmd < o.fromYmd) return false;
  if (o.toYmd && todayYmd > o.toYmd) return false;
  return true;
}

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
// Index wie Date.getUTCDay(): 0 = Sonntag.
const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export interface SeasonRecap {
  visitDays: number;
  starts: number;
  /** Längste Serie an Wochen in Folge. */
  streakWeeks: number;
  bestMonth: { name: string; visitDays: number } | null;
  bestWeekday: { name: string; visitDays: number } | null;
  /** Tag mit den meisten Starts. */
  bestDay: { day: string; starts: number } | null;
  firstDay: string | null;
  lastDay: string | null;
}

/** Saisonrückblick aus den Tagessummen eines Jahres. Bei Gleichstand gewinnt der frühere Monat bzw. Wochentag ab Montag. */
export function seasonRecap(days: DayStat[]): SeasonRecap {
  const visited = days.filter((d) => d.starts > 0).sort((a, b) => a.day.localeCompare(b.day));
  const months = new Array<number>(12).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  let bestDay: SeasonRecap["bestDay"] = null;
  for (const d of visited) {
    const [y, m, dd] = d.day.split("-").map(Number);
    months[m - 1] += 1;
    weekdays[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()] += 1;
    if (!bestDay || d.starts > bestDay.starts) bestDay = { day: d.day, starts: d.starts };
  }
  const topMonth = months.indexOf(Math.max(...months));
  // Ab Montag suchen, damit bei Gleichstand nicht der Sonntag vorne liegt.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const topWeekday = order.reduce((best, i) => (weekdays[i] > weekdays[best] ? i : best), order[0]);
  return {
    visitDays: visited.length,
    starts: visited.reduce((sum, d) => sum + d.starts, 0),
    streakWeeks: longestWeekStreak(visited.map((d) => d.day)),
    bestMonth: visited.length ? { name: MONTH_NAMES[topMonth], visitDays: months[topMonth] } : null,
    bestWeekday: visited.length ? { name: WEEKDAY_NAMES[topWeekday], visitDays: weekdays[topWeekday] } : null,
    bestDay,
    firstDay: visited[0]?.day ?? null,
    lastDay: visited[visited.length - 1]?.day ?? null,
  };
}

/**
 * Anteil der anderen Fahrer (in Prozent, abgerundet), die seltener da waren.
 * Null, wenn es zu wenige Vergleichswerte gibt.
 */
export function aheadOfPercent(own: number, others: number[], minOthers = 10): number | null {
  if (others.length < minOthers) return null;
  return Math.floor((others.filter((v) => v < own).length / others.length) * 100);
}

/** So viele Tage vor dem Ablauf erinnert die Kunden-App an die Verlängerung. */
export const RENEWAL_HINT_DAYS = 30;

export type RenewalHint = { kind: "soon"; days: number } | { kind: "expired" };

/**
 * Hinweis zur Verlängerung: in den letzten 30 Tagen der Laufzeit und nach dem
 * Ablauf. Ohne Enddatum oder mit längerer Restlaufzeit gibt es keinen.
 */
export function renewalHint(endDate: Date | null, now: Date): RenewalHint | null {
  if (!endDate) return null;
  const ms = endDate.getTime() - now.getTime();
  if (ms < 0) return { kind: "expired" };
  const days = Math.ceil(ms / 86_400_000);
  return days <= RENEWAL_HINT_DAYS ? { kind: "soon", days } : null;
}
