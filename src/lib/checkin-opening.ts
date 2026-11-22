/**
 * Öffnungszeit des Shops für die Tagesauswahl im Check-in-Monitor.
 *
 * Reine Rechenlogik ohne Prisma: Die Route lädt die Profile, der Monitor
 * zeigt nur das fertige Ergebnis. Der Monitor importiert von hier nur Typen,
 * damit kein Datenbank-Code in den Browser gerät.
 */

import { openingForDay, operatingSpansForDay, type ScheduleSpec } from "./operating-hours";
import { DEFAULT_TIMEZONE } from "./tz-time";

const SHOP_NAME = /shop/i;
const LIFT_NAME = /wasserski|wakeboard|seilbahn|lift/i;

export interface CheckinDayOpening {
  /** Name des Profils, z. B. „Wasserski & Shop“. */
  scheduleName: string;
  closed: boolean;
  /** Spannen des Tages, z. B. [{ from: "10", to: "18" }] (kurze Uhrzeit). */
  windows: { from: string; to: string }[];
  /** Beginn der ersten Spanne als ISO-Zeitpunkt; null, wenn zu. */
  opensAt: string | null;
  /** Notiz eines Ausnahmetags, z. B. „Nikolaus“. */
  note: string | null;
}

/** Welches Profil gilt für den Shop? Erst „Shop“, dann Lift, dann Vorbelegung, dann das einzige. */
export function pickShopSchedule<T extends { name: string; isDefault: boolean }>(schedules: T[]): T | null {
  return (
    schedules.find((s) => SHOP_NAME.test(s.name)) ??
    schedules.find((s) => LIFT_NAME.test(s.name)) ??
    schedules.find((s) => s.isDefault) ??
    (schedules.length === 1 ? schedules[0] : null)
  );
}

/** "12:00" -> "12", "12:30" -> "12:30". */
function shortTime(hhmm: string): string {
  return hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : hhmm.replace(/^0/, "");
}

export function checkinDayOpening(
  schedule: ScheduleSpec,
  ymd: string,
  tz: string = DEFAULT_TIMEZONE,
): CheckinDayOpening {
  const day = openingForDay(schedule, ymd);
  const spans = operatingSpansForDay(schedule, ymd, tz);
  return {
    scheduleName: schedule.name,
    closed: day.closed || day.windows.length === 0,
    windows: day.windows.map((w) => ({ from: shortTime(w.opensAt), to: shortTime(w.closesAt) })),
    opensAt: spans[0]?.from.toISOString() ?? null,
    note: day.source === "exception" ? day.label : null,
  };
}

/**
 * Text für die Tageszeile, solange noch nicht geöffnet ist; null, wenn nichts
 * gezeigt werden soll (vergangener Tag oder schon geöffnet).
 */
export function checkinOpeningText(
  opening: CheckinDayOpening | null | undefined,
  ymd: string,
  today: string,
  now: Date,
): string | null {
  if (!opening || ymd < today) return null;
  if (opening.closed) return opening.note ? `Geschlossen · ${opening.note}` : "Geschlossen";
  if (!opening.opensAt || now.getTime() >= new Date(opening.opensAt).getTime()) return null;
  const ranges = opening.windows.map((w) => `${w.from}–${w.to}`).join(" und ");
  const first = opening.windows[0];
  const text =
    ymd !== today
      ? `Geöffnet ${ranges} Uhr`
      : opening.windows.length === 1
        ? `Öffnet um ${first.from} Uhr · bis ${first.to} Uhr`
        : `Öffnet um ${first.from} Uhr · ${ranges} Uhr`;
  return opening.note ? `${text} · ${opening.note}` : text;
}
