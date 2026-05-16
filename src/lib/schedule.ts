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

/**
 * Liefert den `DayKey` fuer einen Datumswert in Berliner Zeit.
 */
export function berlinDayKey(now: Date = new Date()): DayKey {
  const berlin = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  // JS-Sonntag = 0 ... Samstag = 6
  const map: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[berlin.getDay()];
}

/**
 * Liefert die aktuelle Minute (0-1439) in Berliner Zeit.
 */
export function berlinMinuteOfDay(now: Date = new Date()): number {
  const berlin = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  return berlin.getHours() * 60 + berlin.getMinutes();
}

function parseHM(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * Prueft, ob `now` (Default: jetzt) innerhalb des Wochenplans liegt.
 * Konvention: am betreffenden Wochentag muss `enabled: true` und die
 * aktuelle Minute im Bereich `[on, off)` (oder `[on, off]` bei off>=on)
 * liegen. Ist `on` oder `off` leer, wird "ganzer Tag" angenommen, sobald
 * `enabled: true` ist.
 *
 * Liefert `null`, wenn der Plan komplett leer/uninteressant ist (Aufrufer
 * soll dann ignorieren).
 */
export function isWithinSchedule(
  raw: unknown,
  now: Date = new Date(),
): { ok: boolean; reason?: string } | null {
  if (!raw) return null;
  const schedule = parseSchedule(raw);
  if (!hasAnySchedule(schedule)) return null;

  const day = berlinDayKey(now);
  const cfg = schedule[day];
  const minutes = berlinMinuteOfDay(now);

  if (!cfg.enabled) {
    return { ok: false, reason: `Heute (${DAY_LABELS[day]}) nicht freigegeben` };
  }

  const onMin = cfg.on ? parseHM(cfg.on) : null;
  const offMin = cfg.off ? parseHM(cfg.off) : null;

  if (onMin === null && offMin === null) {
    return { ok: true };
  }
  if (onMin !== null && minutes < onMin) {
    return { ok: false, reason: `Erst ab ${cfg.on} Uhr (${DAY_LABELS[day]})` };
  }
  if (offMin !== null && minutes >= offMin) {
    return { ok: false, reason: `Bis ${cfg.off} Uhr (${DAY_LABELS[day]})` };
  }
  return { ok: true };
}
