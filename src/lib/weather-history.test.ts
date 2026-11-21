import { test } from "node:test";
import assert from "node:assert/strict";
import { FORECAST_PAST_DAYS, historyStart, parseHourlyTemps, weatherRequests } from "./weather-history";

const NOW = new Date("2026-11-21T10:22:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

test("historyStart: ein Tag vor dem ersten Besuchstag, frühestens ab dem Vorjahr", () => {
  assert.equal(historyStart(new Date("2026-05-09T00:00:00Z"), NOW).toISOString(), "2026-05-08T00:00:00.000Z");
  assert.equal(historyStart(new Date("2023-04-01T00:00:00Z"), NOW).toISOString(), "2024-12-31T00:00:00.000Z");
  // Ohne Besuchstag reicht der letzte Tag bis zur laufenden Stunde.
  assert.equal(historyStart(null, NOW).toISOString(), "2026-11-20T10:00:00.000Z");
});

test("weatherRequests: Archiv für alte Tage, Vorhersage-API nur für die letzten zehn", () => {
  const to = new Date("2026-11-21T10:00:00Z");
  assert.equal(FORECAST_PAST_DAYS, 10);
  const all = weatherRequests(new Date("2026-05-08T00:00:00Z"), to, NOW);
  assert.equal(all.length, 2);
  assert.match(all[0].url, /archive-api/);
  assert.deepEqual(all[0].params, { start_date: "2026-05-08", end_date: "2026-11-10" });
  assert.equal(iso(all[0].toMs), "2026-11-10T23:00:00.000Z");
  assert.match(all[1].url, /api\.open-meteo\.com\/v1\/forecast/);
  assert.deepEqual(all[1].params, { past_days: "10", forecast_days: "1" });
  // Beide Bereiche schließen ohne Lücke und ohne Überschneidung aneinander an.
  assert.equal(iso(all[1].fromMs), "2026-11-11T00:00:00.000Z");
  assert.equal(all[1].toMs, to.getTime());

  // Die Lücke vom 21.11.2026 (21.08. bis 09.09.): die Vorhersage-API lieferte
  // diese Tage nicht, sie kommen jetzt aus dem Archiv.
  const hole = weatherRequests(new Date("2026-08-21T00:00:00Z"), new Date("2026-09-09T23:00:00Z"), NOW);
  assert.equal(hole.length, 1);
  assert.match(hole[0].url, /archive-api/);
  assert.deepEqual(hole[0].params, { start_date: "2026-08-21", end_date: "2026-09-09" });

  // Laufender Betrieb: nur die neue Stunde, also nur heute.
  const next = weatherRequests(to, to, NOW);
  assert.equal(next.length, 1);
  assert.deepEqual(next[0].params, { past_days: "0", forecast_days: "1" });

  // Nach zwei Tagen Pause reicht past_days bis zum Tag der Lücke zurück.
  const gap = weatherRequests(new Date("2026-11-19T07:00:00Z"), to, NOW);
  assert.deepEqual(gap.map((r) => r.params), [{ past_days: "2", forecast_days: "1" }]);

  // Nur alte Stunden: nur das Archiv.
  const old = weatherRequests(new Date("2026-05-08T00:00:00Z"), new Date("2026-06-30T23:00:00Z"), NOW);
  assert.deepEqual(old.map((r) => r.params), [{ start_date: "2026-05-08", end_date: "2026-06-30" }]);

  assert.deepEqual(weatherRequests(new Date("2026-11-21T11:00:00Z"), to, NOW), []);
});

test("parseHourlyTemps: nur volle Stunden im Bereich und mit Wert", () => {
  const t = (s: string) => Date.parse(s) / 1000;
  const data = {
    hourly: {
      time: [t("2026-11-21T08:00:00Z"), t("2026-11-21T09:00:00Z"), t("2026-11-21T09:30:00Z"), t("2026-11-21T10:00:00Z"), t("2026-11-21T11:00:00Z")],
      temperature_2m: [4.1, null, 5, 6.2, 7.3],
    },
  };
  const rows = parseHourlyTemps(data, Date.parse("2026-11-21T08:00:00Z"), Date.parse("2026-11-21T10:00:00Z"));
  assert.deepEqual(
    rows.map((r) => [r.hour.toISOString(), r.temp]),
    [["2026-11-21T08:00:00.000Z", 4.1], ["2026-11-21T10:00:00.000Z", 6.2]],
  );
  assert.deepEqual(parseHourlyTemps(null, 0, 1), []);
  assert.deepEqual(parseHourlyTemps({ hourly: { time: "x" } }, 0, 1), []);
  assert.deepEqual(parseHourlyTemps({ error: true, reason: "kaputt" }, 0, 1), []);
});
