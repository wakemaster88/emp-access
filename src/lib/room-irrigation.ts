/**
 * Bewässerung eines Raums, verdichtet für das Widget in der Raumkarte
 * (Mockup W18). Reine Rechenhilfen ohne Datenbank, damit Server-Seite und
 * Browser dieselben Begriffe benutzen: nächster Lauf, Fortschritt einer
 * Sequenz, Verbrauch je Tag.
 */

import type { IrrigationLevel } from "@/lib/irrigation";
import { addDaysToYmd, tzInstant, tzYmd, weekdayBitOfYmd } from "@/lib/tz-time";

/** Angenommener Durchfluss, wenn die Zone keinen pflegt (wie in irrigation.ts). */
const DEFAULT_FLOW_LPH = 720;

export interface IrrigationValve {
  id: number;
  name: string;
  isActive: boolean;
  /** Durchfluss in Liter je Stunde, null = unbekannt (Annahme 720 l/h). */
  flowLph: number | null;
}

/** Ein Schritt eines laufenden Sequenz-Plans (Pumpe → Ventile nacheinander). */
export interface IrrigationStep {
  deviceId: number;
  name: string;
  minutes: number;
  /** ISO-Zeitpunkt, sobald das Ventil geöffnet wurde; null = wartet noch. */
  startedAt: string | null;
}

export interface RoomIrrigationSchedule {
  id: number;
  /** Name des Zeitplan-Geräts (Pumpe bei Sequenz, sonst das Ventil). */
  name: string;
  deviceId: number;
  daysOfWeek: number;
  startTime: string;
  durationMinutes: number;
  isActive: boolean;
  skipOnRain: boolean;
  smartRain: boolean;
  sensorServiceId: string | null;
  moistureThresholdPct: number | null;
  /** Ventile in Reihenfolge (deviceId ist dann die Pumpe); null = Einzelventil. */
  valveIds: number[] | null;
  /** Laufender Plan aus `runState`, null = nichts läuft. */
  run: { startedAt: string; steps: IrrigationStep[] } | null;
  lastRunAt: string | null;
  /** Nächster planmäßiger Start als ISO-Zeit; null = inaktiv oder keine Tage. */
  nextRunAt: string | null;
}

export interface IrrigationDay {
  /** Kalendertag "YYYY-MM-DD" in der Zeitzone des Mandanten. */
  date: string;
  liters: number;
  minutes: number;
  runs: number;
}

export interface RoomIrrigation {
  valves: IrrigationValve[];
  schedules: RoomIrrigationSchedule[];
  /** Wetter-Empfehlung des Mandanten (siehe getIrrigationRecommendation). */
  recommendation: { level: IrrigationLevel; factor: number; reason: string } | null;
  weather: { tempMaxToday: number | null; precipSumToday: number | null; precipProbToday: number | null } | null;
  /** Die letzten sieben Kalendertage, ältester zuerst, letzter = heute. */
  days: IrrigationDay[];
}

/**
 * Nächster Start eines Zeitplans ab `now`: heute, falls die Uhrzeit noch vor
 * uns liegt, sonst der nächste passende Wochentag innerhalb einer Woche.
 */
export function nextScheduleRun(
  s: { daysOfWeek: number; startTime: string; isActive: boolean },
  now: Date,
  tz: string | null | undefined,
): Date | null {
  if (!s.isActive || (s.daysOfWeek & 127) === 0) return null;
  const today = tzYmd(now, tz);
  for (let offset = 0; offset <= 7; offset++) {
    const ymd = addDaysToYmd(today, offset);
    if (((s.daysOfWeek >> weekdayBitOfYmd(ymd)) & 1) !== 1) continue;
    const at = tzInstant(ymd, s.startTime, tz);
    if (!at) return null;
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}

/** Verbrauch je Kalendertag der letzten `dayCount` Tage, ältester zuerst. */
export function bucketRunsByDay(
  runs: { startedAt: Date; durationMinutes: number; litersEstimate: number | null }[],
  now: Date,
  tz: string | null | undefined,
  dayCount = 7,
): IrrigationDay[] {
  const today = tzYmd(now, tz);
  const days: IrrigationDay[] = [];
  const byDate = new Map<string, IrrigationDay>();
  for (let offset = dayCount - 1; offset >= 0; offset--) {
    const day = { date: addDaysToYmd(today, -offset), liters: 0, minutes: 0, runs: 0 };
    days.push(day);
    byDate.set(day.date, day);
  }
  for (const run of runs) {
    const day = byDate.get(tzYmd(run.startedAt, tz));
    if (!day) continue;
    day.liters += run.litersEstimate ?? 0;
    day.minutes += run.durationMinutes;
    day.runs += 1;
  }
  for (const day of days) day.liters = Math.round(day.liters);
  return days;
}

/** Geschätzte Liter für eine Laufzeit an einem Ventil. */
export function litersFor(minutes: number, valve: { flowLph: number | null } | undefined): number {
  const flow = valve?.flowLph && valve.flowLph > 0 ? valve.flowLph : DEFAULT_FLOW_LPH;
  return Math.round((flow / 60) * minutes);
}

export interface RunProgress {
  /** Index des laufenden Schritts (0-basiert), null wenn gerade keiner offen ist. */
  current: number | null;
  /** Abgeschlossene Schritte. */
  done: number;
  total: number;
  /** Restsekunden des laufenden Schritts. */
  remainingSec: number;
  /** Bisher ausgebrachte Liter (abgeschlossene Schritte voll, laufender anteilig). */
  litersSoFar: number;
  /** Alle Schritte durch – der Takt räumt den Plan gleich auf. */
  finished: boolean;
}

/** Fortschritt eines laufenden Sequenz-Plans zum Zeitpunkt `nowMs`. */
export function runProgress(
  run: { steps: IrrigationStep[] },
  valves: IrrigationValve[],
  nowMs: number,
): RunProgress {
  const valveById = new Map(valves.map((v) => [v.id, v]));
  let current: number | null = null;
  let done = 0;
  let remainingSec = 0;
  let litersSoFar = 0;
  run.steps.forEach((step, i) => {
    if (!step.startedAt) return;
    const start = Date.parse(step.startedAt);
    const end = start + step.minutes * 60_000;
    const full = litersFor(step.minutes, valveById.get(step.deviceId));
    if (nowMs >= end) {
      done += 1;
      litersSoFar += full;
    } else {
      current = i;
      remainingSec = Math.max(0, Math.round((end - nowMs) / 1000));
      litersSoFar += Math.round((full * (nowMs - start)) / (end - start));
    }
  });
  return {
    current,
    done,
    total: run.steps.length,
    remainingSec,
    litersSoFar,
    finished: run.steps.length > 0 && done === run.steps.length,
  };
}

/** Zustand eines Schritts für die Anzeige. */
export function stepState(step: IrrigationStep, nowMs: number): "done" | "running" | "waiting" {
  if (!step.startedAt) return "waiting";
  return nowMs >= Date.parse(step.startedAt) + step.minutes * 60_000 ? "done" : "running";
}

/** "morgen 05:30", "heute 18:00", "Mo 05:30" – für Kachel und Widget. */
export function fmtNextRun(at: Date, now: Date, tz: string | null | undefined): string {
  const time = new Intl.DateTimeFormat("de-DE", { timeZone: tz ?? undefined, hour: "2-digit", minute: "2-digit" }).format(at);
  const today = tzYmd(now, tz);
  const day = tzYmd(at, tz);
  if (day === today) return `heute ${time}`;
  if (day === addDaysToYmd(today, 1)) return `morgen ${time}`;
  const weekday = new Intl.DateTimeFormat("de-DE", { timeZone: tz ?? undefined, weekday: "short" }).format(at).replace(".", "");
  return `${weekday} ${time}`;
}

/** "noch 9 Min", "noch 45 s". */
export function fmtRemainingSec(sec: number): string {
  if (sec < 60) return `noch ${sec} s`;
  return `noch ${Math.ceil(sec / 60)} Min`;
}

/** "1.250 l" */
export function fmtLiters(l: number): string {
  return `${Math.round(l).toLocaleString("de-DE")} l`;
}
