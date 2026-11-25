import { openingForDay, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd } from "./tz-time";

/**
 * Öffentliche Betriebszeiten für die Website (tuttenbrocksee.com) und andere
 * Leser ohne Anmeldung. Rein und ohne Datenbank, damit es sich testen lässt;
 * geladen wird in `api/public/betriebszeiten`.
 *
 * Herausgegeben wird nur, was ohnehin öffentlich ist: Name des Bereichs und
 * Zeiten je Tag. Beschreibung, Räume und interne Ids der Saisons bleiben drin.
 */

/** So weit lässt sich in einem Aufruf vorausschauen (gut ein Jahr). */
export const PUBLIC_MAX_DAYS = 400;
export const PUBLIC_DEFAULT_DAYS = 14;

export interface PublicWindow {
  von: string;
  bis: string;
}

export interface PublicDay {
  datum: string;
  geoeffnet: boolean;
  zeiten: PublicWindow[];
  /** Wie die Website es anzeigt: „12:00 - 18:00“ oder „geschlossen“. */
  text: string;
  /** Ausnahmetag (Feiertag, Sonderöffnung) statt regulärem Wochenplan. */
  ausnahme: boolean;
  /** Notiz des Ausnahmetags, z. B. „Nikolaus“. */
  hinweis: string | null;
}

export interface PublicArea {
  id: number;
  name: string;
  /** Stabiler Schlüssel aus dem Namen, z. B. „wasserski“, „gastronomie“. */
  schluessel: string;
  tage: PublicDay[];
}

/** „Wasserski & Shop“ -> „wasserski-shop“, „Café“ -> „cafe“. */
export function areaKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function publicDay(spec: ScheduleSpec, ymd: string): PublicDay {
  const day = openingForDay(spec, ymd);
  const zeiten = day.windows.map((w) => ({ von: w.opensAt, bis: w.closesAt }));
  const geoeffnet = !day.closed && zeiten.length > 0;
  return {
    datum: ymd,
    geoeffnet,
    zeiten: geoeffnet ? zeiten : [],
    text: geoeffnet ? zeiten.map((z) => `${z.von} - ${z.bis}`).join(", ") : "geschlossen",
    ausnahme: day.source === "exception",
    hinweis: day.source === "exception" ? day.label : null,
  };
}

export function publicArea(
  schedule: { id: number; name: string; spec: ScheduleSpec },
  from: string,
  days: number,
): PublicArea {
  const tage: PublicDay[] = [];
  for (let i = 0; i < days; i++) tage.push(publicDay(schedule.spec, addDaysToYmd(from, i)));
  return { id: schedule.id, name: schedule.name, schluessel: areaKey(schedule.name), tage };
}

const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface PublicQuery {
  from: string;
  days: number;
  /** Nur diese Bereiche (Schlüssel oder Id); leer = alle. */
  areas: string[];
}

/** Abfrage lesen; `today` ist das heutige Datum in Europe/Berlin. */
export function parsePublicQuery(
  params: URLSearchParams,
  today: string,
): PublicQuery | { error: string } {
  const von = params.get("von");
  if (von != null && !YMD_RE.test(von)) return { error: "von muss JJJJ-MM-TT sein" };
  const from = von ?? today;

  let days = PUBLIC_DEFAULT_DAYS;
  const bis = params.get("bis");
  const tage = params.get("tage");
  if (bis != null) {
    if (!YMD_RE.test(bis)) return { error: "bis muss JJJJ-MM-TT sein" };
    const diff = Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    if (diff < 0) return { error: "bis liegt vor von" };
    days = diff + 1;
  } else if (tage != null) {
    const n = Number(tage);
    if (!Number.isInteger(n) || n < 1) return { error: "tage muss eine ganze Zahl ab 1 sein" };
    days = n;
  }
  if (days > PUBLIC_MAX_DAYS) return { error: `höchstens ${PUBLIC_MAX_DAYS} Tage je Abfrage` };

  const areas = (params.get("bereich") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { from, days, areas };
}

/** So weit reicht `von` zurück bzw. voraus (ab heute, in Tagen). */
export const PUBLIC_PAST_DAYS = 40;
export const PUBLIC_FUTURE_DAYS = 400;

/**
 * `von` auf ein festes Fenster um heute begrenzen: frühestens heute − 40 Tage
 * oder der Erste des Vormonats (was früher liegt; der Monatskalender der
 * Website blättert einen Monat zurück), spätestens heute + 400 Tage. Abfragen
 * außerhalb werden auf das Fenster gezogen, nicht abgelehnt; `bis` bleibt,
 * solange es im Fenster liegt.
 */
export function clampPublicQuery(query: PublicQuery, today: string): PublicQuery {
  const [y, m] = today.split("-").map(Number);
  const prevMonthStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const pastLimit = addDaysToYmd(today, -PUBLIC_PAST_DAYS);
  const minFrom = prevMonthStart < pastLimit ? prevMonthStart : pastLimit;
  const maxFrom = addDaysToYmd(today, PUBLIC_FUTURE_DAYS);
  if (query.from < minFrom) {
    const last = addDaysToYmd(query.from, query.days - 1);
    const days =
      last < minFrom ? 1 : Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${minFrom}T00:00:00Z`)) / 86_400_000) + 1;
    return { ...query, from: minFrom, days };
  }
  if (query.from > maxFrom) return { ...query, from: maxFrom };
  return query;
}

/** Passt ein Profil zum Filter `bereich=`? Schlüssel, Anfang des Schlüssels oder Id. */
export function matchesArea(schedule: { id: number; name: string }, areas: string[]): boolean {
  if (areas.length === 0) return true;
  const key = areaKey(schedule.name);
  return areas.some((a) => a === String(schedule.id) || a === key || key.startsWith(`${a}-`));
}
