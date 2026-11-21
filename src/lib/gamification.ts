/**
 * Gamification für Abo-Fahrer: reine Rechenlogik ohne Datenbank.
 *
 * Grundlage sind Tagessummen je Abo-Ticket (`RiderDayStat`): ein Besuchstag ist
 * ein Kalendertag (Europe/Berlin) mit mindestens einem Start, ein Start ist ein
 * GRANTED-Scan an einem Gerät mit `countsAsStart`. Die Datenbank-Seite steht in
 * `gamification-service.ts`.
 */
import { berlinYmd } from "./berlin-day";

export type GamiMetric =
  | "VISIT_DAYS"
  | "STARTS"
  | "STREAK_WEEKS"
  | "EARLY_DAYS"
  | "WEEKENDS"
  | "EVENT_DAYS"
  | "OPENING_DAY"
  | "COLD_DAYS"
  | "SEASONS";
export type GamiPeriod = "SEASON" | "MONTH" | "ALL_TIME";
/** Seltenheit eines Awards: bestimmt das Metall des Abzeichens. */
export type GamiTier = "BRONZE" | "SILVER" | "GOLD" | "LEGENDARY";

export const GAMI_METRICS: GamiMetric[] = [
  "VISIT_DAYS", "STARTS", "STREAK_WEEKS", "EARLY_DAYS", "WEEKENDS", "OPENING_DAY", "COLD_DAYS", "EVENT_DAYS", "SEASONS",
];
/** Challenges haben einen festen Zeitraum: dort zählen nur diese drei. */
export const CHALLENGE_METRICS: GamiMetric[] = ["VISIT_DAYS", "STARTS", "STREAK_WEEKS"];
export const GAMI_PERIODS: GamiPeriod[] = ["SEASON", "MONTH", "ALL_TIME"];
export const GAMI_TIERS: GamiTier[] = ["BRONZE", "SILVER", "GOLD", "LEGENDARY"];

export const METRIC_LABEL: Record<GamiMetric, string> = {
  VISIT_DAYS: "Besuchstage",
  STARTS: "Starts",
  STREAK_WEEKS: "Wochen in Serie",
  EARLY_DAYS: "Tage mit Start in der ersten Stunde",
  WEEKENDS: "Wochenenden in Folge",
  EVENT_DAYS: "Aktionstage",
  OPENING_DAY: "Erster Tag der Saison",
  COLD_DAYS: "Tage mit kaltem Wasser",
  SEASONS: "Saisons",
};

export const PERIOD_LABEL: Record<GamiPeriod, string> = {
  SEASON: "Saison",
  MONTH: "Monat",
  ALL_TIME: "Gesamt",
};

export const TIER_LABEL: Record<GamiTier, string> = {
  BRONZE: "Bronze",
  SILVER: "Silver",
  GOLD: "Gold",
  LEGENDARY: "Legendary",
};

/** So lange nach dem ersten Start des Tages gilt ein Start als früh. */
export const EARLY_WINDOW_MS = 60 * 60_000;

/**
 * Wassertemperatur eines Besuchstags: gemessen wird von so lange vor dem
 * ersten bis so lange nach dem letzten Start der Person.
 */
export const WATER_WINDOW_MS = 60 * 60_000;

/** Tagessumme: Kalendertag als "YYYY-MM-DD" und die Starts an diesem Tag. */
export interface DayStat {
  day: string;
  starts: number;
  /** Erster Start lag in der ersten Stunde nach dem ersten Start des Tages am Lift. */
  early?: boolean;
  /** Kälteste Wassertemperatur (°C), während die Person an dem Tag am Lift war; fehlt ohne Messwert. */
  waterTemp?: number;
}

export interface MilestoneRule {
  id: number;
  metric: GamiMetric;
  threshold: number;
  period: GamiPeriod;
  /**
   * Aktionstage als "YYYY-MM-DD" (`EVENT_DAYS`). Bei `OPENING_DAY` ersetzt ein
   * hier eingetragener Tag den automatisch ermittelten ersten Tag seines Jahres.
   */
  eventDays?: string[];
  /** Grenze in °C: das Wasser muss kälter sein (nur für `COLD_DAYS`). */
  tempBelow?: number | null;
}

export interface Metrics {
  visitDays: number;
  starts: number;
  streakWeeks: number;
  earlyDays: number;
  weekends: number;
}

/** Schlüssel für Awards ohne Zeitraum: sie werden genau einmal vergeben. */
export const ALL_TIME_KEY = "all";

/** Schlüssel des Zeitraums, in den ein Tag fällt: "2027" (Saison), "2027-06" (Monat) oder "all". */
export function periodKey(period: GamiPeriod, ymd: string): string {
  if (period === "ALL_TIME") return ALL_TIME_KEY;
  return period === "MONTH" ? ymd.slice(0, 7) : ymd.slice(0, 4);
}

/** Liegt der Tag im Zeitraum, in den der Stichtag fällt? */
export function inPeriod(day: string, period: GamiPeriod, refYmd: string): boolean {
  return period === "ALL_TIME" || day.startsWith(periodKey(period, refYmd));
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

/** Fällt der Tag auf Samstag oder Sonntag? */
export function isWeekendDay(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
}

/** Längste Folge aufeinanderfolgender Wochenenden (Samstag oder Sonntag) mit Besuch. */
export function longestWeekendStreak(days: string[]): number {
  // Samstag und Sonntag liegen in derselben Woche (Montag bis Sonntag).
  return longestWeekStreak(days.filter(isWeekendDay));
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
    earlyDays: visited.filter((d) => d.early).length,
    weekends: longestWeekendStreak(visited.map((d) => d.day)),
  };
}

/** Wert einer Kennzahl. Aktionstage, erster Tag, kaltes Wasser und Saisons brauchen mehr als Tagessummen: siehe `ruleValue`. */
export function metricValue(metrics: Metrics, metric: GamiMetric): number {
  switch (metric) {
    case "VISIT_DAYS": return metrics.visitDays;
    case "STARTS": return metrics.starts;
    case "STREAK_WEEKS": return metrics.streakWeeks;
    case "EARLY_DAYS": return metrics.earlyDays;
    case "WEEKENDS": return metrics.weekends;
    default: return 0;
  }
}

/**
 * Saisons dabei: Jahre mit mindestens einem Besuchstag bis zum Stichtag. Hat
 * das Personal an der Person ein früheres Startjahr eingetragen
 * (`ridingSince`), zählen die Jahre davor lückenlos mit.
 */
export function seasonsCount(days: DayStat[], ridingSince: number | null | undefined, refYmd: string): number {
  const refYear = Number(refYmd.slice(0, 4));
  const years = new Set<number>();
  for (const d of days) {
    const y = Number(d.day.slice(0, 4));
    if (d.starts > 0 && y <= refYear) years.add(y);
  }
  if (years.size === 0) return 0;
  const first = Math.min(...years);
  const before = ridingSince != null && ridingSince >= 1950 && ridingSince < first ? first - ridingSince : 0;
  return years.size + before;
}

/** Erster Tag der Saison je Jahr: {"2027": "2027-03-27"}. */
export type OpeningDays = Readonly<Record<string, string>>;

/** Was außer den Tagessummen in die Zählung eingeht. */
export interface RuleContext {
  capPerDay: number;
  /** Saisons dabei (`seasonsCount`); ohne Angabe aus den Tagessummen. */
  seasons?: number;
  /** Automatisch ermittelter erster Tag der Saison je Jahr (für `OPENING_DAY`). */
  openingDays?: OpeningDays;
}

/**
 * Erster Tag der Saison eines Jahres: ein von Hand eingetragener Tag (bei
 * mehreren der früheste) geht vor dem automatisch ermittelten. Null, solange
 * in dem Jahr noch niemand gefahren ist und nichts eingetragen wurde.
 */
export function openingDayOf(
  year: string,
  eventDays: readonly string[] | undefined,
  auto: OpeningDays | undefined,
): string | null {
  const manual = (eventDays ?? []).filter((d) => d.startsWith(`${year}-`)).sort();
  return manual[0] ?? auto?.[year] ?? null;
}

/** Wert eines Meilensteins zum Stichtag, im Zeitraum, in den der Stichtag fällt. */
export function ruleValue(
  rule: Pick<MilestoneRule, "metric" | "period" | "eventDays" | "tempBelow">,
  days: DayStat[],
  refYmd: string,
  ctx: RuleContext,
): number {
  if (rule.metric === "SEASONS") return ctx.seasons ?? seasonsCount(days, null, refYmd);
  const scoped = days.filter((d) => inPeriod(d.day, rule.period, refYmd));
  if (rule.metric === "EVENT_DAYS") {
    const events = new Set(rule.eventDays ?? []);
    return scoped.filter((d) => d.starts > 0 && events.has(d.day)).length;
  }
  if (rule.metric === "OPENING_DAY") {
    return scoped.filter(
      (d) => d.starts > 0 && d.day === openingDayOf(d.day.slice(0, 4), rule.eventDays, ctx.openingDays),
    ).length;
  }
  if (rule.metric === "COLD_DAYS") {
    const limit = rule.tempBelow;
    if (limit == null) return 0;
    return scoped.filter((d) => d.starts > 0 && d.waterTemp != null && d.waterTemp < limit).length;
  }
  return metricValue(computeMetrics(scoped, ctx.capPerDay), rule.metric);
}

/** Schlüssel, unter dem ein vergebener Meilenstein gemerkt wird. */
export function awardKey(milestoneId: number, key: string): string {
  return `${milestoneId}:${key}`;
}

/**
 * Welche Meilensteine sind zum Stichtag erreicht und noch nicht vergeben?
 *
 * `days` enthält die Tagessummen der Person (für Awards ohne Zeitraum alle
 * Jahre); gezählt wird je Meilenstein nur der Zeitraum, in dem der Stichtag
 * liegt. `seasons` sind die Saisons dabei, wenn sie nicht allein aus den
 * Tagessummen folgen, `openingDays` der erste Tag der Saison je Jahr.
 */
export function reachedMilestones(
  milestones: MilestoneRule[],
  days: DayStat[],
  refYmd: string,
  capPerDay: number,
  awarded: ReadonlySet<string>,
  seasons?: number,
  openingDays?: OpeningDays,
): Array<{ milestoneId: number; periodKey: string }> {
  const out: Array<{ milestoneId: number; periodKey: string }> = [];
  for (const m of milestones) {
    if (m.threshold <= 0) continue;
    const key = periodKey(m.period, refYmd);
    if (awarded.has(awardKey(m.id, key))) continue;
    if (ruleValue(m, days, refYmd, { capPerDay, seasons, openingDays }) >= m.threshold) {
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

/** Grad-Zahl für Texte: "10" oder "9,5". */
export function formatDegrees(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

/** Bedingung eines Meilensteins in Worten, z. B. "10 Besuchstage · Saison". */
export function milestoneConditionText(m: {
  metric: GamiMetric;
  threshold: number;
  period: GamiPeriod;
  tempBelow?: number | null;
}): string {
  if (m.metric === "OPENING_DAY") return `${METRIC_LABEL.OPENING_DAY} · ${PERIOD_LABEL[m.period]}`;
  if (m.metric === "COLD_DAYS") {
    const days = m.threshold === 1 ? "1 Tag" : `${m.threshold.toLocaleString("de-DE")} Tage`;
    const water = m.tempBelow != null ? `Wasser unter ${formatDegrees(m.tempBelow)} °C` : "kaltem Wasser";
    return `${days} mit ${water} · ${PERIOD_LABEL[m.period]}`;
  }
  return `${m.threshold.toLocaleString("de-DE")} ${METRIC_LABEL[m.metric]} · ${PERIOD_LABEL[m.period]}`;
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
 * derselbe Kalendertag zählt einmal, die Starts werden addiert. Früh war der
 * Tag, wenn es eines der Tickets war; beim Wasser gilt der kälteste Wert.
 */
export function mergeDayStats(days: DayStat[]): DayStat[] {
  const byDay = new Map<string, { starts: number; early: boolean; waterTemp: number | undefined }>();
  for (const d of days) {
    const cur = byDay.get(d.day);
    if (cur) {
      cur.starts += d.starts;
      cur.early = cur.early || !!d.early;
      if (d.waterTemp != null) cur.waterTemp = cur.waterTemp == null ? d.waterTemp : Math.min(cur.waterTemp, d.waterTemp);
    } else {
      byDay.set(d.day, { starts: d.starts, early: !!d.early, waterTemp: d.waterTemp });
    }
  }
  return [...byDay.entries()]
    .map(([day, v]) => ({
      day,
      starts: v.starts,
      ...(v.early && { early: true }),
      ...(v.waterTemp != null && { waterTemp: v.waterTemp }),
    }))
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
  seasons?: number,
  openingDays?: OpeningDays,
): MilestoneProgress[] {
  return milestones.map((m) => {
    const value = ruleValue(m, days, refYmd, { capPerDay, seasons, openingDays });
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

/** Preisliste aus der Einstellung lesen: {"<id>": Cent}. Ungültiges fällt weg. */
export function parsePriceMap(value: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, cents] of Object.entries(value as Record<string, unknown>)) {
    const id = Number(key);
    if (Number.isInteger(id) && id > 0 && typeof cents === "number" && Number.isInteger(cents) && cents > 0) {
      out.set(id, cents);
    }
  }
  return out;
}

/** Ab so vielen Besuchen zeigt die App Tagesgästen den Abo-Rechner. */
export const ABO_CALCULATOR_MIN_VISITS = 3;

export interface AboCalculation {
  tickets: number;
  spentCents: number;
  /** Das günstigste Abo mit hinterlegtem Preis. */
  aboName: string;
  aboCents: number;
}

/**
 * Abo-Rechner für Tagesgäste: Was haben die Tickets dieser Saison gekostet,
 * was kostet das Abo? Gibt nur dann etwas zurück, wenn jede Zahl echt ist:
 * ab drei Besuchen, jeder Ticketpreis hinterlegt und mindestens ein Abo-Preis.
 */
export function aboCalculation(
  visitDays: number,
  ticketCents: Array<number | null | undefined>,
  abos: Array<{ name: string; cents: number }>,
): AboCalculation | null {
  if (visitDays < ABO_CALCULATOR_MIN_VISITS || ticketCents.length === 0 || abos.length === 0) return null;
  let spentCents = 0;
  for (const c of ticketCents) {
    if (c == null || c <= 0) return null;
    spentCents += c;
  }
  const abo = [...abos].sort((a, b) => a.cents - b.cents)[0];
  return { tickets: ticketCents.length, spentCents, aboName: abo.name, aboCents: abo.cents };
}

/** "25 €" oder "24,50 €". */
export function formatEuro(cents: number): string {
  const whole = cents % 100 === 0;
  return `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })} €`;
}
