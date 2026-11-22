/**
 * Statistik der Kunden App für die Verwaltung (Kunden App › Übersicht): wie
 * viele Personen welchen Award schaffen, wie sich Besuchstage und Starts
 * verteilen und wie die Saison Monat für Monat lief. Reine Rechenlogik ohne
 * Datenbank; gezählt wird je Person (Profil, sonst Ticket), wie bei den Awards.
 */
import { ruleValue, seasonsCount, type DayStat, type MilestoneRule, type OpeningDays } from "./gamification";

export interface PersonDays {
  key: string;
  /** Tagessummen der Person über alle Jahre, ein Eintrag je Tag. */
  days: DayStat[];
  ridingSince?: number | null;
}

export interface AwardReach {
  milestoneId: number;
  /** Personen, die das Ziel zum Stichtag erreicht haben; null = nicht nachrechenbar. */
  reached: number | null;
}

/** Zählarten, die sich allein aus den Tagessummen nachrechnen lassen. */
const COUNTABLE = new Set(["VISIT_DAYS", "STARTS", "STREAK_WEEKS", "WEEKENDS", "SEASONS", "EVENT_DAYS", "OPENING_DAY"]);

export function awardReach(
  persons: PersonDays[],
  milestones: MilestoneRule[],
  refYmd: string,
  capPerDay: number,
  openingDays?: OpeningDays,
): AwardReach[] {
  return milestones.map((m) => {
    if (!COUNTABLE.has(m.metric) || m.threshold <= 0) return { milestoneId: m.id, reached: null };
    let reached = 0;
    for (const p of persons) {
      const seasons = m.metric === "SEASONS" ? seasonsCount(p.days, p.ridingSince, refYmd) : undefined;
      if (ruleValue(m, p.days, refYmd, { capPerDay, seasons, openingDays }) >= m.threshold) reached += 1;
    }
    return { milestoneId: m.id, reached };
  });
}

export interface Bucket {
  label: string;
  count: number;
}

/** Personen je Bereich, Grenzen aufsteigend: [1, 25, 100] → „1–24“, „25–99“, „ab 100“. */
export function bucketize(values: number[], bounds: number[], unit: string): Bucket[] {
  const sorted = [...new Set(bounds)].filter((b) => b > 0).sort((a, b) => a - b);
  return sorted.map((lo, i) => {
    const hi = sorted[i + 1];
    const count = values.filter((v) => v >= lo && (hi == null || v < hi)).length;
    const fmt = (n: number) => n.toLocaleString("de-DE");
    const label = hi == null ? `ab ${fmt(lo)} ${unit}` : hi - 1 === lo ? `${fmt(lo)} ${unit}` : `${fmt(lo)} bis ${fmt(hi - 1)} ${unit}`;
    return { label, count };
  });
}

export interface MonthRow {
  month: string;
  persons: number;
  visitDays: number;
  starts: number;
}

/** Saison Monat für Monat: Personen, Besuchstage und Starts (Starts je Tag gedeckelt). */
export function monthRows(persons: PersonDays[], year: string, capPerDay: number): MonthRow[] {
  const map = new Map<string, { persons: Set<string>; visitDays: number; starts: number }>();
  for (const p of persons) {
    for (const d of p.days) {
      if (!d.day.startsWith(year) || d.starts <= 0) continue;
      const month = d.day.slice(0, 7);
      const row = map.get(month) ?? { persons: new Set<string>(), visitDays: 0, starts: 0 };
      row.persons.add(p.key);
      row.visitDays += 1;
      row.starts += Math.min(d.starts, capPerDay);
      map.set(month, row);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, r]) => ({ month, persons: r.persons.size, visitDays: r.visitDays, starts: r.starts }));
}

/** Tagessummen je Person zusammenführen: mehrere Tickets am selben Tag ergeben einen Tag. */
export function groupPersonDays(
  rows: Array<{ person: string; day: string; starts: number }>,
  ridingSince: ReadonlyMap<string, number | null> = new Map(),
): PersonDays[] {
  const map = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const days = map.get(r.person) ?? new Map<string, number>();
    days.set(r.day, (days.get(r.day) ?? 0) + r.starts);
    map.set(r.person, days);
  }
  return [...map.entries()].map(([key, days]) => ({
    key,
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, starts]) => ({ day, starts })),
    ridingSince: ridingSince.get(key) ?? null,
  }));
}
