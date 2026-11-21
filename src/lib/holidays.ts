/**
 * Feiertage für die Kunden-App (Standort Tuttenbrocksee, NRW). Reine
 * Rechenlogik ohne Datenbank, damit auch Client-Komponenten sie nutzen dürfen.
 *
 * Gesetzliche Feiertage in NRW plus ein paar Tage, die keine sind, an denen
 * ein Gruß aber gut passt (Heiligabend, Silvester, Oster- und Pfingstsonntag).
 * Das Datum rechnet die App jedes Jahr selbst aus; eingestellt wird je
 * Feiertag nur einmal (`RiderHoliday.key`).
 */

export type HolidayShowKind = "GREETING" | "OFFER" | "VOUCHER";

export const HOLIDAY_SHOW_LABEL: Record<HolidayShowKind, string> = {
  GREETING: "Grußwort",
  OFFER: "Angebot",
  VOUCHER: "Gutschein",
};

export interface HolidayDef {
  key: string;
  name: string;
  /** Gesetzlicher Feiertag in NRW. */
  legal: boolean;
  /** Vorschlag für die Überschrift in der App. */
  greeting: string;
  /** Tag im Jahr: fest (Monat, Tag) oder Abstand zum Ostersonntag. */
  at: { month: number; day: number } | { easter: number };
}

export const HOLIDAYS: HolidayDef[] = [
  { key: "neujahr", name: "Neujahr", legal: true, greeting: "Frohes neues Jahr", at: { month: 1, day: 1 } },
  { key: "karfreitag", name: "Karfreitag", legal: true, greeting: "Schöne Ostertage", at: { easter: -2 } },
  { key: "ostersonntag", name: "Ostersonntag", legal: false, greeting: "Frohe Ostern", at: { easter: 0 } },
  { key: "ostermontag", name: "Ostermontag", legal: true, greeting: "Frohe Ostern", at: { easter: 1 } },
  { key: "tag-der-arbeit", name: "Tag der Arbeit", legal: true, greeting: "Schönen 1. Mai", at: { month: 5, day: 1 } },
  { key: "christi-himmelfahrt", name: "Christi Himmelfahrt", legal: true, greeting: "Schönen Vatertag", at: { easter: 39 } },
  { key: "pfingstsonntag", name: "Pfingstsonntag", legal: false, greeting: "Frohe Pfingsten", at: { easter: 49 } },
  { key: "pfingstmontag", name: "Pfingstmontag", legal: true, greeting: "Frohe Pfingsten", at: { easter: 50 } },
  { key: "fronleichnam", name: "Fronleichnam", legal: true, greeting: "Schönen Feiertag", at: { easter: 60 } },
  { key: "tag-der-deutschen-einheit", name: "Tag der Deutschen Einheit", legal: true, greeting: "Schönen Feiertag", at: { month: 10, day: 3 } },
  { key: "allerheiligen", name: "Allerheiligen", legal: true, greeting: "Schönen Feiertag", at: { month: 11, day: 1 } },
  { key: "heiligabend", name: "Heiligabend", legal: false, greeting: "Frohe Weihnachten", at: { month: 12, day: 24 } },
  { key: "weihnachten-1", name: "1. Weihnachtstag", legal: true, greeting: "Frohe Weihnachten", at: { month: 12, day: 25 } },
  { key: "weihnachten-2", name: "2. Weihnachtstag", legal: true, greeting: "Frohe Weihnachten", at: { month: 12, day: 26 } },
  { key: "silvester", name: "Silvester", legal: false, greeting: "Guten Rutsch", at: { month: 12, day: 31 } },
];

export const HOLIDAY_BY_KEY = new Map(HOLIDAYS.map((h) => [h.key, h]));

/** Höchstens so viele Tage vorher darf ein Feiertag schon erscheinen. */
export const HOLIDAY_MAX_DAYS_BEFORE = 14;

const pad = (n: number) => String(n).padStart(2, "0");

function toYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Kalendertag „YYYY-MM-DD“ um `days` verschieben. */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

/** Ostersonntag (gregorianisch, Anonymer Algorithmus nach Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Datum eines Feiertags in einem Jahr. */
export function holidayDate(def: HolidayDef, year: number): string {
  if ("easter" in def.at) return addDaysYmd(easterSunday(year), def.at.easter);
  return `${year}-${pad(def.at.month)}-${pad(def.at.day)}`;
}

export interface HolidayOccurrence {
  key: string;
  name: string;
  legal: boolean;
  greeting: string;
  ymd: string;
}

/** Alle Feiertage ab heute (einschließlich) für die nächsten 12 Monate, nach Datum. */
export function upcomingHolidays(todayYmd: string): HolidayOccurrence[] {
  const year = Number(todayYmd.slice(0, 4));
  const until = addDaysYmd(todayYmd, 365);
  const out: HolidayOccurrence[] = [];
  for (const y of [year, year + 1]) {
    for (const h of HOLIDAYS) {
      const ymd = holidayDate(h, y);
      if (ymd >= todayYmd && ymd < until) out.push({ key: h.key, name: h.name, legal: h.legal, greeting: h.greeting, ymd });
    }
  }
  return out.sort((a, b) => a.ymd.localeCompare(b.ymd));
}

export interface HolidaySetting {
  key: string;
  active: boolean;
  daysBefore: number;
}

/**
 * Der Feiertag, den die App heute zeigt: eingeschaltet, und heute liegt
 * zwischen „Tage vorher“ und dem Feiertag selbst. Überschneiden sich zwei
 * (z. B. Heiligabend und 1. Weihnachtstag), gewinnt der nächstliegende.
 */
export function currentHoliday<T extends HolidaySetting>(
  settings: T[],
  todayYmd: string,
): { setting: T; ymd: string; year: number; def: HolidayDef } | null {
  const year = Number(todayYmd.slice(0, 4));
  let best: { setting: T; ymd: string; year: number; def: HolidayDef } | null = null;
  for (const s of settings) {
    if (!s.active) continue;
    const def = HOLIDAY_BY_KEY.get(s.key);
    if (!def) continue;
    const before = Math.min(HOLIDAY_MAX_DAYS_BEFORE, Math.max(0, s.daysBefore));
    // Kurz vor Neujahr liegt der Feiertag schon im nächsten Jahr.
    for (const y of [year, year + 1]) {
      const ymd = holidayDate(def, y);
      if (todayYmd <= ymd && todayYmd >= addDaysYmd(ymd, -before)) {
        if (!best || ymd < best.ymd) best = { setting: s, ymd, year: y, def };
        break;
      }
    }
  }
  return best;
}

/** „Mo., 6. Apr.“ für die Verwaltung. */
export function holidayDayLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00.000Z`).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
