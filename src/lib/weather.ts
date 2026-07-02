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
  /// Referenz-Verdunstung (FAO ET₀) heute in mm.
  et0Today: number | null;
  /// ET₀ der Vortage in mm: Index 0 = gestern, 1 = vorgestern, 2 = vor 3 Tagen.
  et0Past: (number | null)[];
  /// Gefallener Regen der Vortage in mm (gleiche Reihenfolge wie et0Past).
  precipPast: (number | null)[];
  fetchedAt: string;
}

/// Anzahl abgefragter Vergangenheits-Tage (fuer die Wasserbilanz).
export const WEATHER_PAST_DAYS = 3;

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
    daily: "temperature_2m_max,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration",
    past_days: String(WEATHER_PAST_DAYS),
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
        et0_fao_evapotranspiration?: (number | null)[];
      };
    };

    // Daily-Arrays enthalten [vor 3 Tagen, vorgestern, gestern, heute, morgen].
    const daily = data.daily ?? {};
    const T = WEATHER_PAST_DAYS; // Index von "heute"
    const at = (arr: (number | null)[] | undefined, i: number) => arr?.[i] ?? null;
    // Vortage rueckwaerts: Index 0 = gestern, 1 = vorgestern, 2 = vor 3 Tagen.
    const pastDesc = (arr: (number | null)[] | undefined) =>
      Array.from({ length: T }, (_, i) => at(arr, T - 1 - i));

    const weather: Weather = {
      currentTemp: data.current?.temperature_2m ?? null,
      tempMaxToday: at(daily.temperature_2m_max, T),
      precipSumToday: at(daily.precipitation_sum, T),
      precipProbToday: at(daily.precipitation_probability_max, T),
      precipSumTomorrow: at(daily.precipitation_sum, T + 1),
      precipProbTomorrow: at(daily.precipitation_probability_max, T + 1),
      et0Today: at(daily.et0_fao_evapotranspiration, T),
      et0Past: pastDesc(daily.et0_fao_evapotranspiration),
      precipPast: pastDesc(daily.precipitation_sum),
      fetchedAt: new Date().toISOString(),
    };

    cache.set(key, { weather, expiresAt: Date.now() + CACHE_TTL_MS });
    return weather;
  } catch {
    return null;
  }
}
