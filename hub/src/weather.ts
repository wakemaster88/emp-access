/**
 * Wetterbericht fuer den Hub (Open-Meteo, kostenlos, ohne Schluessel).
 *
 * Grundlage fuer die Energie-, Maeh- und Bewaesserungsplanung des
 * Hub-Assistenten. Standort: Account-Koordinaten aus der Cloud
 * (/api/hub/rooms → location), sonst HUB_LAT/HUB_LON aus hub/.env, sonst die
 * Anlage am Tuttenbrocksee. Stuendliche Werte fuer gestern bis uebermorgen,
 * 30 Minuten im Speicher.
 */
import { log } from "./config.js";
import { roomsLocation } from "./rooms.js";

const URL_BASE = "https://api.open-meteo.com/v1/forecast";
const TTL_MS = 30 * 60_000;
/** Tuttenbrocksee (Beckum), falls weder Cloud noch .env einen Standort nennen. */
const FALLBACK = { latitude: 51.756, longitude: 8.043 };

export interface WeatherHour {
  /** ISO-Zeit (UTC). */
  t: string;
  tempC: number | null;
  precipMm: number | null;
  precipProb: number | null;
  code: number | null;
  windKmh: number | null;
  cloudPct: number | null;
}

export interface WeatherDay {
  /** YYYY-MM-DD (Ortszeit). */
  date: string;
  tMin: number | null;
  tMax: number | null;
  precipMm: number | null;
  precipProb: number | null;
  code: number | null;
  sunrise: string | null;
  sunset: string | null;
}

export interface Forecast {
  fetchedAt: string;
  location: { latitude: number; longitude: number; source: "cloud" | "env" | "fallback" };
  current: { tempC: number | null; code: number | null } | null;
  hours: WeatherHour[];
  days: WeatherDay[];
}

let cached: { at: number; key: string; data: Forecast } | null = null;
let lastError: string | null = null;

function location(): Forecast["location"] {
  const cloud = roomsLocation();
  if (cloud) return { ...cloud, source: "cloud" };
  const lat = Number(process.env.HUB_LAT);
  const lon = Number(process.env.HUB_LON);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) return { latitude: lat, longitude: lon, source: "env" };
  return { ...FALLBACK, source: "fallback" };
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function weatherError(): string | null {
  return lastError;
}

/** Aktueller Wetterbericht; null, wenn Open-Meteo nicht erreichbar war und nichts im Speicher liegt. */
export async function getForecast(): Promise<Forecast | null> {
  const loc = location();
  const key = `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`;
  if (cached && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.data;
  const params = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,cloud_cover",
    daily: "temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,weather_code,sunrise,sunset",
    past_days: "1",
    forecast_days: "3",
    timezone: "Europe/Berlin",
    timeformat: "unixtime",
  });
  try {
    const res = await fetch(`${URL_BASE}?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as {
      current?: Record<string, number>;
      hourly?: Record<string, (number | null)[]>;
      daily?: Record<string, (number | string | null)[]>;
    };
    const h = j.hourly ?? {};
    const time = (h.time ?? []) as number[];
    const hours: WeatherHour[] = time.map((ts, i) => ({
      t: new Date(ts * 1000).toISOString(),
      tempC: n(h.temperature_2m?.[i]),
      precipMm: n(h.precipitation?.[i]),
      precipProb: n(h.precipitation_probability?.[i]),
      code: n(h.weather_code?.[i]),
      windKmh: n(h.wind_speed_10m?.[i]),
      cloudPct: n(h.cloud_cover?.[i]),
    }));
    const d = j.daily ?? {};
    const dtime = (d.time ?? []) as number[];
    const iso = (v: unknown) => (typeof v === "number" ? new Date(v * 1000).toISOString() : null);
    const days: WeatherDay[] = dtime.map((ts, i) => ({
      date: new Date(ts * 1000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }),
      tMin: n(d.temperature_2m_min?.[i]),
      tMax: n(d.temperature_2m_max?.[i]),
      precipMm: n(d.precipitation_sum?.[i]),
      precipProb: n(d.precipitation_probability_max?.[i]),
      code: n(d.weather_code?.[i]),
      sunrise: iso(d.sunrise?.[i]),
      sunset: iso(d.sunset?.[i]),
    }));
    const data: Forecast = {
      fetchedAt: new Date().toISOString(),
      location: loc,
      current: j.current ? { tempC: n(j.current.temperature_2m), code: n(j.current.weather_code) } : null,
      hours,
      days,
    };
    cached = { at: Date.now(), key, data };
    if (lastError) log("Wetter: Open-Meteo wieder erreichbar");
    lastError = null;
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (lastError !== msg) log(`Wetter: Open-Meteo nicht erreichbar (${msg})`);
    lastError = msg;
    return cached?.data ?? null;
  }
}

/** WMO-Wettercode in Worten. */
export function weatherText(code: number | null): string {
  if (code == null) return "unbekannt";
  if (code === 0) return "klar";
  if (code <= 2) return "heiter";
  if (code === 3) return "bedeckt";
  if (code === 45 || code === 48) return "Nebel";
  if (code >= 51 && code <= 57) return "Niesel";
  if (code >= 61 && code <= 67) return "Regen";
  if (code >= 71 && code <= 77) return "Schnee";
  if (code >= 80 && code <= 82) return "Schauer";
  if (code >= 85 && code <= 86) return "Schneeschauer";
  if (code >= 95) return "Gewitter";
  return "wechselhaft";
}
