/**
 * Eigene, dependency-freie Sonnenauf-/Sonnenuntergangs-Berechnung (NOAA Solar
 * Equations, vereinfachte Form). Genauigkeit ca. ±1 Minute – reicht für
 * Automationen (Lampen schalten etc.).
 *
 * Quelle/Herleitung: NOAA Solar Calculator Formeln (öffentlich, kein Copyright).
 */

export interface SunTimes {
  /** Sonnenaufgang als UTC-Datum (oder null bei Polarnacht/-tag). */
  sunrise: Date | null;
  /** Sonnenuntergang als UTC-Datum (oder null bei Polarnacht/-tag). */
  sunset: Date | null;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function toJulian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

function julianCentury(j: number): number {
  return (j - 2451545) / 36525;
}

function solarDeclination(t: number): number {
  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const sunEqOfCtr =
    Math.sin(DEG * meanAnom) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(DEG * 2 * meanAnom) * (0.019993 - 0.000101 * t) +
    Math.sin(DEG * 3 * meanAnom) * 0.000289;
  const sunTrueLong = meanLong + sunEqOfCtr;
  const sunAppLong =
    sunTrueLong - 0.00569 - 0.00478 * Math.sin(DEG * (125.04 - 1934.136 * t));
  const meanObliqEcliptic =
    23 +
    (26 +
      (21.448 -
        t * (46.815 + t * (0.00059 - t * 0.001813))) /
        60) /
      60;
  const obliqCorr =
    meanObliqEcliptic + 0.00256 * Math.cos(DEG * (125.04 - 1934.136 * t));
  return RAD * Math.asin(Math.sin(DEG * obliqCorr) * Math.sin(DEG * sunAppLong));
  // ignore eccent in simplified form – fine within a minute
}

function equationOfTime(t: number): number {
  const epsilon =
    23 +
    (26 +
      (21.448 -
        t * (46.815 + t * (0.00059 - t * 0.001813))) /
        60) /
      60;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const y = Math.tan(DEG * (epsilon / 2)) ** 2;

  const eTime =
    y * Math.sin(2 * DEG * l0) -
    2 * e * Math.sin(DEG * m) +
    4 * e * y * Math.sin(DEG * m) * Math.cos(2 * DEG * l0) -
    0.5 * y * y * Math.sin(4 * DEG * l0) -
    1.25 * e * e * Math.sin(2 * DEG * m);
  return 4 * RAD * eTime; // in minutes
}

/**
 * Berechnet Sonnenaufgang und -untergang für einen bestimmten Tag (local) an
 * einer Position. Gibt UTC-Timestamps zurück.
 *
 * @param date   Beliebiger Zeitpunkt innerhalb des gewünschten Tages (UTC).
 * @param lat    Breitengrad (z.B. 52.52 für Berlin).
 * @param lng    Längengrad (z.B. 13.405 für Berlin).
 */
export function getSunTimes(date: Date, lat: number, lng: number): SunTimes {
  // Mittag UTC am Zieltag als Referenzpunkt
  const noonUtc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0)
  );
  const jd = toJulian(noonUtc);
  const t = julianCentury(jd);

  const decl = solarDeclination(t);
  const eqTime = equationOfTime(t);

  // Hour angle für Sonnenaufgang/Untergang (Sonne am Horizont, -0.833° wegen
  // Refraktion + Sonnenscheibendurchmesser).
  const zenith = 90.833;
  const cosH =
    (Math.cos(DEG * zenith) -
      Math.sin(DEG * lat) * Math.sin(DEG * decl)) /
    (Math.cos(DEG * lat) * Math.cos(DEG * decl));

  if (cosH > 1) {
    // Sonne geht an diesem Tag nicht auf (Polarnacht)
    return { sunrise: null, sunset: null };
  }
  if (cosH < -1) {
    // Sonne geht nicht unter (Polartag)
    return { sunrise: null, sunset: null };
  }

  const hourAngle = RAD * Math.acos(cosH); // in degrees
  // Solar noon (UTC, minutes since 0:00)
  const solarNoonUtcMin = 720 - 4 * lng - eqTime;
  const sunriseUtcMin = solarNoonUtcMin - 4 * hourAngle;
  const sunsetUtcMin = solarNoonUtcMin + 4 * hourAngle;

  const dayStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0)
  ).getTime();

  return {
    sunrise: new Date(dayStart + sunriseUtcMin * 60_000),
    sunset: new Date(dayStart + sunsetUtcMin * 60_000),
  };
}

/**
 * Komfortfunktion: sunrise/sunset für "heute" an einer Position.
 * Fallback auf Berlin, wenn lat/lng null ist.
 */
export function getSunTimesForAccount(
  lat: number | null | undefined,
  lng: number | null | undefined,
  now: Date = new Date()
): SunTimes {
  const latitude = lat ?? 52.52;
  const longitude = lng ?? 13.405;
  return getSunTimes(now, latitude, longitude);
}
