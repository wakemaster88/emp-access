import { prisma } from "./prisma";
import { openingForDay, operatingSpanState, operatingSpansForDay, type ScheduleSpec } from "./operating-hours";
import { scheduleSpecInclude, toScheduleSpec } from "./operating-queries";
import { shortTime } from "./rider-calendar";
import { DEFAULT_TIMEZONE, addDaysToYmd, formatHhmm, tzMinutesOfDay, tzYmd, weekdayBitOfYmd } from "./tz-time";

/**
 * Öffnungszeiten am Lift für die Karte „Auslastung jetzt“ der Kunden-App.
 *
 * Quelle sind die Betriebszeiten (`/betriebszeiten`) samt Ausnahmetagen. Der
 * Lift hängt an keinem Profil; genommen wird das Profil, dessen Name nach Lift
 * klingt („Wasserski & Shop“), sonst die Vorbelegung, sonst das einzige Profil.
 */

/** So weit voraus wird die nächste Öffnung gesucht (Winterpause bis Frühjahr). */
const LOOKAHEAD_DAYS = 150;
const LIFT_NAME = /wasserski|wakeboard|seilbahn|lift/i;
const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export interface RiderOpening {
  open: boolean;
  /** Ein Satz für die Karte, z. B. „Heute geöffnet 12–16 Uhr“ oder „Öffnet morgen um 12 Uhr“. */
  text: string;
  /** Notiz eines heutigen Ausnahmetags, z. B. „Nikolaus“. */
  note: string | null;
}

/** Welches Profil gilt für den Lift? */
export function pickLiftSchedule<T extends { name: string; isDefault: boolean }>(schedules: T[]): T | null {
  return (
    schedules.find((s) => LIFT_NAME.test(s.name)) ??
    schedules.find((s) => s.isDefault) ??
    (schedules.length === 1 ? schedules[0] : null)
  );
}


function shortInstant(at: Date, tz: string): string {
  return shortTime(formatHhmm(tzMinutesOfDay(at, tz)));
}

/** „heute“, „morgen“, „Sa“ (diese Woche) oder „Sa, 06.12.“. */
function dayWord(ymd: string, today: string): string {
  if (ymd === today) return "heute";
  if (ymd === addDaysToYmd(today, 1)) return "morgen";
  const wd = WEEKDAY_SHORT[weekdayBitOfYmd(ymd)];
  if (ymd <= addDaysToYmd(today, 6)) return wd;
  return `${wd}, ${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.`;
}

export function riderOpening(schedule: ScheduleSpec, now: Date, tz: string = DEFAULT_TIMEZONE): RiderOpening {
  const today = tzYmd(now, tz);
  const day = openingForDay(schedule, today);
  const note = day.source === "exception" ? day.label : null;
  const state = operatingSpanState(schedule, now, tz, { openMinutes: 0, closeMinutes: 0 }, LOOKAHEAD_DAYS);

  if (state.inside) {
    const todayRanges = day.windows.map((w) => `${shortTime(w.opensAt)}–${shortTime(w.closesAt)}`);
    // Läuft gerade noch die Spanne von gestern (über Mitternacht), passt „heute 12–16“ nicht.
    const ms = now.getTime();
    const fromToday = operatingSpansForDay(schedule, today, tz).some((s) => ms >= s.from.getTime() && ms < s.to.getTime());
    const text =
      fromToday
        ? `Heute geöffnet ${todayRanges.join(" und ")} Uhr`
        : `Geöffnet bis ${state.until ? shortInstant(state.until, tz) : "?"} Uhr`;
    return { open: true, text, note };
  }

  if (!state.until) return { open: false, text: "Zurzeit keine Öffnungszeiten geplant", note };
  const opensDay = dayWord(tzYmd(state.until, tz), today);
  const word = opensDay === "heute" || opensDay === "morgen" ? opensDay : `am ${opensDay}`;
  return { open: false, text: `Öffnet ${word} um ${shortInstant(state.until, tz)} Uhr`, note };
}

/** Öffnungszeiten am Lift für ein Konto; null, wenn kein passendes Profil eingerichtet ist. */
export async function loadRiderOpening(accountId: number, now: Date = new Date()): Promise<RiderOpening | null> {
  const schedules = await prisma.operatingSchedule.findMany({
    where: { accountId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: scheduleSpecInclude,
  });
  const schedule = pickLiftSchedule(schedules);
  if (!schedule) return null;
  return riderOpening(toScheduleSpec(schedule), now);
}

export interface RiderSchedule {
  id: number;
  name: string;
  spec: ScheduleSpec;
}

/** Alle Betriebszeiten-Profile für den Kalender der Kunden-App, das des Lifts zuerst. */
export async function loadRiderSchedules(accountId: number): Promise<RiderSchedule[]> {
  const schedules = await prisma.operatingSchedule.findMany({
    where: { accountId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: scheduleSpecInclude,
  });
  const lift = pickLiftSchedule(schedules);
  return [...schedules]
    .sort((a, b) => Number(b === lift) - Number(a === lift))
    .map((s) => ({ id: s.id, name: s.name, spec: toScheduleSpec(s) }));
}
