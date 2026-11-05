import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayForecast, weatherCodeText } from "./weather-day";

const hours = Array.from({ length: 24 }, (_, h) => `2026-07-10T${String(h).padStart(2, "0")}:00`);

test("parseDayForecast: Tageswerte und Regenfenster", () => {
  const prob = hours.map((_, h) => (h >= 13 && h < 16 ? 70 : h === 6 ? 90 : 10));
  const mm = hours.map((_, h) => (h >= 13 && h < 16 ? 0.5 : 0));
  const f = parseDayForecast(
    {
      daily: {
        time: ["2026-07-10"],
        weather_code: [80],
        temperature_2m_min: [14.24],
        temperature_2m_max: [26.06],
        precipitation_sum: [1.5],
        precipitation_probability_max: [70],
        wind_speed_10m_max: [22],
        wind_gusts_10m_max: [55],
        sunrise: ["2026-07-10T04:58"],
        sunset: ["2026-07-10T21:30"],
        sunshine_duration: [36000],
      },
      hourly: { time: hours, temperature_2m: hours.map((_, h) => 10 + h), precipitation: mm, precipitation_probability: prob },
    },
    "2026-07-10",
    "x",
  );
  assert.ok(f);
  assert.equal(f.summary, "Regenschauer");
  assert.equal(f.tempMin, 14.2);
  assert.equal(f.tempMax, 26.1);
  assert.equal(f.sunrise, "04:58");
  assert.equal(f.sunshineHours, 10);
  // 6 Uhr liegt vor Betriebsbeginn und zaehlt nicht
  assert.deepEqual(f.rainWindows, [{ from: "13:00", to: "16:00", maxProbPct: 70, mm: 1.5 }]);
  assert.deepEqual(f.temps, [
    { at: "10:00", temp: 20 },
    { at: "14:00", temp: 24 },
    { at: "18:00", temp: 28 },
  ]);
});

test("parseDayForecast: falscher Tag gibt null", () => {
  assert.equal(parseDayForecast({ daily: { time: ["2026-07-11"] } }, "2026-07-10"), null);
});

test("weatherCodeText", () => {
  assert.equal(weatherCodeText(0), "sonnig");
  assert.equal(weatherCodeText(95), "Gewitter");
  assert.equal(weatherCodeText(null), "unbekannt");
});
