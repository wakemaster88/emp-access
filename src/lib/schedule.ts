export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface DaySchedule {
  enabled: boolean;
  on: string;  // "HH:MM"
  off: string; // "HH:MM"
}

export type WeekSchedule = Record<DayKey, DaySchedule>;

export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Mo", tue: "Di", wed: "Mi", thu: "Do",
  fri: "Fr", sat: "Sa", sun: "So",
};

export const DAY_FULL_LABELS: Record<DayKey, string> = {
  mon: "Montag", tue: "Dienstag", wed: "Mittwoch", thu: "Donnerstag",
  fri: "Freitag", sat: "Samstag", sun: "Sonntag",
};

export function emptySchedule(): WeekSchedule {
  return Object.fromEntries(
    DAY_KEYS.map((d) => [d, { enabled: false, on: "", off: "" }])
  ) as WeekSchedule;
}

export function parseSchedule(raw: unknown): WeekSchedule {
  if (!raw || typeof raw !== "object") return emptySchedule();
  const base = emptySchedule();
  for (const key of DAY_KEYS) {
    const day = (raw as Record<string, unknown>)[key];
    if (day && typeof day === "object") {
      const d = day as Record<string, unknown>;
      base[key] = {
        enabled: Boolean(d.enabled),
        on: typeof d.on === "string" ? d.on : "",
        off: typeof d.off === "string" ? d.off : "",
      };
    }
  }
  return base;
}

export function hasAnySchedule(schedule: WeekSchedule): boolean {
  return DAY_KEYS.some((d) => schedule[d].enabled && (schedule[d].on || schedule[d].off));
}
