/**
 * Wetterdaten über Open-Meteo (https://open-meteo.com/).
 *
 * Open-Meteo ist kostenlos und benötigt keinen API-Key. Wir nutzen es fuer die
 * smarte Bewässerungs-Empfehlung (Temperatur + Regen). Ergebnisse werden pro
 * Standort (auf ~11 km gerundet) fuer 30 Minuten im Speicher gecacht, damit
 * Seitenaufrufe und Cron-Ticks nicht bei jedem Mal die API treffen.
 */

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

// Fallback: Berlin (wie in lib/sun.ts).
const DEFAULT_LAT = 52.52;
const DEFAULT_LNG = 13.405;

export interface Weather {
  currentTemp: number | null;
  tempMaxToday: number | null;
  precipSumToday: number | null;       // mm
  precipProbToday: number | null;      // %
  precipSumTomorrow: number | null;    // mm
  precipProbTomorrow: number | null;   // %
  fetchedAt: string;
}

type CacheEntry = { weather: Weather; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Test-Helper. */
export function _clearWeatherCache() {
  cache.clear();
}

function cacheKey(lat: number, lng: number): string {
  // Auf 1 Nachkommastelle runden (~11 km) → gute Cache-Trefferquote.
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

export async function getWeather(
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<Weather | null> {
  const latitude = lat ?? DEFAULT_LAT;
  const longitude = lng ?? DEFAULT_LNG;
  const key = cacheKey(latitude, longitude);

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.weather;

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m",
    daily: "temperature_2m_max,precipitation_sum,precipitation_probability_max",
    forecast_days: "2",
    timezone: "auto",
  });

  try {
    const res = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: { temperature_2m?: number };
      daily?: {
        temperature_2m_max?: (number | null)[];
        precipitation_sum?: (number | null)[];
        precipitation_probability_max?: (number | null)[];
      };
    };

    const daily = data.daily ?? {};
    const weather: Weather = {
      currentTemp: data.current?.temperature_2m ?? null,
      tempMaxToday: daily.temperature_2m_max?.[0] ?? null,
      precipSumToday: daily.precipitation_sum?.[0] ?? null,
      precipProbToday: daily.precipitation_probability_max?.[0] ?? null,
      precipSumTomorrow: daily.precipitation_sum?.[1] ?? null,
      precipProbTomorrow: daily.precipitation_probability_max?.[1] ?? null,
      fetchedAt: new Date().toISOString(),
    };

    cache.set(key, { weather, expiresAt: Date.now() + CACHE_TTL_MS });
    return weather;
  } catch {
    return null;
  }
}
