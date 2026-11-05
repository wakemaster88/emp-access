/**
 * Tageswetter fuer die Tagesvorschau (Hub-Assistent, Telegram um 7:30).
 *
 * Quelle ist wie bei der Bewaesserung Open-Meteo (kostenlos, ohne Key). Fuer
 * die Vorschau zaehlt der Betriebstag: Temperatur-Spanne, Regen mit Uhrzeit,
 * Wind und Boeen (Wasserski/Wakeboard), Sonnenauf- und -untergang.
 *
 * `parseDayForecast` ist rein und getestet; `getDayForecast` holt die Daten
 * und cacht sie 30 Minuten je Standort und Tag.
 */

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_LAT = 52.52;
const DEFAULT_LNG = 13.405;
const TZ = "Europe/Berlin";

/** Stunden, die fuer Regenfenster zaehlen (Betriebszeit grob). */
const DAY_FROM_HOUR = 8;
const DAY_TO_HOUR = 21;
/** Ab hier gilt eine Stunde als Regenstunde. */
const RAIN_PROB_PCT = 50;
const RAIN_MM = 0.3;
/** Boeen ab hier (km/h) melden. */
export const GUST_WARN_KMH = 50;

export interface RainWindow {
  /** "HH:00" Beginn, Berliner Zeit. */
  from: string;
  /** "HH:00" Ende (exklusiv). */
  to: string;
  maxProbPct: number | null;
  mm: number;
}

export interface DayForecast {
  date: string;
  code: number | null;
  summary: string;
  tempMin: number | null;
  tempMax: number | null;
  precipSumMm: number | null;
  precipProbPct: number | null;
  windMaxKmh: number | null;
  gustMaxKmh: number | null;
  sunrise: string | null;
  sunset: string | null;
  sunshineHours: number | null;
  rainWindows: RainWindow[];
  /** Temperatur um 10, 14 und 18 Uhr. */
  temps: { at: string; temp: number | null }[];
  fetchedAt: string;
}

/** WMO-Wettercode als kurzer deutscher Text. */
export function weatherCodeText(code: number | null | undefined): string {
  if (code == null) return "unbekannt";
  if (code === 0) return "sonnig";
  if (code === 1) return "überwiegend sonnig";
  if (code === 2) return "teils bewölkt";
  if (code === 3) return "bedeckt";
  if (code === 45 || code === 48) return "Nebel";
  if (code >= 51 && code <= 57) return "Nieselregen";
  if (code >= 61 && code <= 67) return code >= 65 ? "starker Regen" : "Regen";
  if (code >= 71 && code <= 77) return "Schnee";
  if (code >= 80 && code <= 82) return "Regenschauer";
  if (code === 85 || code === 86) return "Schneeschauer";
  if (code >= 95) return "Gewitter";
  return "wechselhaft";
}

type Arr = (number | null)[] | undefined;

interface OpenMeteoDay {
  daily?: {
    time?: string[];
    weather_code?: Arr;
    temperature_2m_min?: Arr;
    temperature_2m_max?: Arr;
    precipitation_sum?: Arr;
    precipitation_probability_max?: Arr;
    wind_speed_10m_max?: Arr;
    wind_gusts_10m_max?: Arr;
    sunrise?: string[];
    sunset?: string[];
    sunshine_duration?: Arr;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: Arr;
    precipitation?: Arr;
    precipitation_probability?: Arr;
  };
}

const round1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const hhmm = (iso: string | undefined | null) => (iso && iso.length >= 16 ? iso.slice(11, 16) : null);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Open-Meteo-Antwort (timezone=Europe/Berlin) fuer einen Tag auswerten. */
export function parseDayForecast(data: OpenMeteoDay, date: string, fetchedAt = new Date().toISOString()): DayForecast | null {
  const d = data.daily ?? {};
  const i = (d.time ?? []).indexOf(date);
  if (i < 0) return null;
  const at = (arr: Arr) => arr?.[i] ?? null;

  const h = data.hourly ?? {};
  const rainWindows: RainWindow[] = [];
  const temps: { at: string; temp: number | null }[] = [];
  let open: RainWindow | null = null;
  (h.time ?? []).forEach((t, k) => {
    if (!t.startsWith(date)) return;
    const hour = Number(t.slice(11, 13));
    const temp = h.temperature_2m?.[k] ?? null;
    if (hour === 10 || hour === 14 || hour === 18) temps.push({ at: hh(hour), temp: round1(temp) });
    if (hour < DAY_FROM_HOUR || hour >= DAY_TO_HOUR) return;
    const prob = h.precipitation_probability?.[k] ?? null;
    const mm = h.precipitation?.[k] ?? 0;
    const wet = (prob != null && prob >= RAIN_PROB_PCT) || (mm ?? 0) >= RAIN_MM;
    if (wet) {
      if (open && open.to === hh(hour)) {
        open.to = hh(hour + 1);
        if (prob != null) open.maxProbPct = Math.max(open.maxProbPct ?? 0, prob);
        open.mm = round1(open.mm + (mm ?? 0)) ?? 0;
      } else {
        open = { from: hh(hour), to: hh(hour + 1), maxProbPct: prob, mm: round1(mm ?? 0) ?? 0 };
        rainWindows.push(open);
      }
    } else {
      open = null;
    }
  });

  const code = at(d.weather_code);
  const sun = at(d.sunshine_duration);
  return {
    date,
    code,
    summary: weatherCodeText(code),
    tempMin: round1(at(d.temperature_2m_min)),
    tempMax: round1(at(d.temperature_2m_max)),
    precipSumMm: round1(at(d.precipitation_sum)),
    precipProbPct: at(d.precipitation_probability_max),
    windMaxKmh: round1(at(d.wind_speed_10m_max)),
    gustMaxKmh: round1(at(d.wind_gusts_10m_max)),
    sunrise: hhmm(d.sunrise?.[i]),
    sunset: hhmm(d.sunset?.[i]),
    sunshineHours: sun == null ? null : round1(sun / 3600),
    rainWindows,
    temps,
    fetchedAt,
  };
}

const cache = new Map<string, { value: DayForecast; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Tagesvorhersage fuer `date` (YYYY-MM-DD, Berliner Kalendertag). null bei Fehler. */
export async function getDayForecast(
  lat: number | null | undefined,
  lng: number | null | undefined,
  date: string,
): Promise<DayForecast | null> {
  const latitude = lat ?? DEFAULT_LAT;
  const longitude = lng ?? DEFAULT_LNG;
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)},${date}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily:
      "weather_code,temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max," +
      "wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,sunshine_duration",
    hourly: "temperature_2m,precipitation,precipitation_probability",
    start_date: date,
    end_date: date,
    timezone: TZ,
    wind_speed_unit: "kmh",
  });
  try {
    const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const value = parseDayForecast((await res.json()) as OpenMeteoDay, date);
    if (value) cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    return null;
  }
}
