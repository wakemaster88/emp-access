import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessTrends,
  diskForecast,
  newHealthStore,
  pruneHealthStore,
  recordDisk,
  recordLink,
  recordPort,
  recordTemp,
  recordUptime,
  reviveHealthStore,
  setLogin,
  trendSummary,
  trendSummaryText,
} from "./early-warning.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 5, 12, 0, 0);

/** Kamera alle 2 s, `drops` Aussetzer à 10 s in der Stunde. */
function camHour(st: ReturnType<typeof newHealthStore>, start: number, drops: number) {
  const dropAt = new Set(Array.from({ length: drops }, (_, i) => Math.floor(((i + 0.5) * 1800) / drops)));
  for (let i = 0; i < 1800; i++) {
    const failing = [...dropAt].some((d) => i >= d && i < d + 5);
    recordLink(st, "cam:7", "Seilbahn B", "camera", !failing, start + i * 2000, failing ? "Zeitüberschreitung" : null);
  }
}

test("Gehäufte Zeitüberschreitungen werden Vorwarnung, einzelne nicht", () => {
  const st = newHealthStore();
  camHour(st, T0, 1);
  assert.equal(assessTrends(st, T0 + HOUR).length, 0);
  camHour(st, T0 + HOUR, 12);
  const f = assessTrends(st, T0 + 2 * HOUR);
  assert.equal(f.length, 1);
  assert.equal(f[0].key, "trend:link:cam:7");
  assert.match(f[0].title, /Seilbahn B.*Zeitüberschreitungen/);
  assert.match(f[0].detail!, /12 Aussetzer/);
});

test("Hysterese: offene Vorwarnung bleibt bei einem Aussetzer bestehen", () => {
  const st = newHealthStore();
  camHour(st, T0, 6);
  camHour(st, T0 + HOUR, 1);
  const now = T0 + 2 * HOUR;
  assert.equal(assessTrends(st, now).length, 0);
  assert.equal(assessTrends(st, now, new Set(["trend:link:cam:7"])).length, 1);
});

test("Ganz ausgefallene Kamera ist kein Trend (meldet der Wächter)", () => {
  const st = newHealthStore();
  recordLink(st, "cam:1", "Halle", "camera", true, T0);
  for (let i = 1; i < 1800; i++) recordLink(st, "cam:1", "Halle", "camera", false, T0 + 2 * HOUR + i * 2000);
  assert.equal(assessTrends(st, T0 + 3 * HOUR).length, 0);
});

test("Neustarts aus der Laufzeit erkennen", () => {
  const st = newHealthStore();
  assert.equal(recordUptime(st, "shelly:a", "Heizung", "Shelly", 10_000, T0), false);
  assert.equal(recordUptime(st, "shelly:a", "Heizung", "Shelly", 10_300, T0 + 5 * MIN), false);
  assert.equal(recordUptime(st, "shelly:a", "Heizung", "Shelly", 60, T0 + 10 * MIN), true);
  // Gleicher Neustart noch einmal gesehen: nicht doppelt zaehlen.
  assert.equal(recordUptime(st, "shelly:a", "Heizung", "Shelly", 360, T0 + 15 * MIN), false);
  assert.equal(assessTrends(st, T0 + 20 * MIN).length, 0);
  recordUptime(st, "shelly:a", "Heizung", "Shelly", 30, T0 + 2 * HOUR);
  const f = assessTrends(st, T0 + 2 * HOUR);
  assert.equal(f.length, 1);
  assert.match(f[0].title, /Shelly Heizung startet häufig neu/);
});

test("Switch-Port: Fehlerzaehler und Flattern, Switch-Neustart zaehlt nicht", () => {
  const st = newHealthStore();
  let lc = 100;
  for (let i = 0; i < 10; i++) {
    recordPort(st, "sw:8", "Switch_Technikraum Port 8", { inErrors: i * 30, lastChange: (lc += i % 2 ? 50 : 0), up: true }, T0 + i * 15 * MIN);
  }
  const keys = assessTrends(st, T0 + 3 * HOUR).map((f) => f.key).sort();
  assert.deepEqual(keys, ["trend:porterr:sw:8"]);
  // Nach Switch-Neustart: Zaehler bei 0, kein negativer Wert, kein Flattern.
  recordPort(st, "sw:8", "Switch_Technikraum Port 8", { inErrors: 0, lastChange: 5, up: true }, T0 + 3 * HOUR, true);
  assert.equal(st.ports["sw:8"].errors.reduce((a, e) => a + e[1], 0), 270);
  for (let i = 0; i < 6; i++) {
    recordPort(st, "sw:8", "Switch_Technikraum Port 8", { inErrors: 0, lastChange: 10 + i, up: i % 2 === 0 }, T0 + 4 * HOUR + i * MIN);
  }
  assert.ok(assessTrends(st, T0 + 5 * HOUR).some((f) => f.key === "trend:flap:sw:8"));
});

test("Platten-Prognose aus dem Verlauf", () => {
  const st = newHealthStore();
  for (let h = 0; h <= 72; h++) recordDisk(st, 0.6 + (h / 24) * 0.02, T0 + h * HOUR);
  const fc = diskForecast(st.disk, T0 + 72 * HOUR)!;
  assert.ok(Math.abs(fc.growthPctPerDay! - 2) < 0.01);
  assert.ok(Math.abs(fc.daysToFull! - 14.5) < 0.1);
  assert.equal(assessTrends(st, T0 + 72 * HOUR).length, 0);
  assert.equal(assessTrends(st, T0 + 72 * HOUR, new Set(["trend:disk"])).length, 1);
  recordDisk(st, 0.7, T0 + 74 * HOUR);
  assert.match(assessTrends(st, T0 + 74 * HOUR)[0].title, /Platte des Hubs in etwa \d+ Tagen voll/);
});

test("Temperatur und Anmeldung", () => {
  const st = newHealthStore();
  recordTemp(st, "shelly:b", "Shelly Pro 4PM", 78, T0);
  setLogin(st, "mammotion", { label: "Mammotion (Mäher)", error: "Mammotion lehnt die Anmeldung ab" }, T0);
  const keys = assessTrends(st, T0).map((f) => f.key).sort();
  assert.deepEqual(keys, ["trend:login:mammotion", "trend:temp:shelly:b"]);
  setLogin(st, "mammotion", null, T0);
  recordTemp(st, "shelly:b", "Shelly Pro 4PM", 72, T0 + 2 * HOUR);
  assert.equal(assessTrends(st, T0 + 2 * HOUR).length, 0);
  assert.equal(assessTrends(st, T0 + 2 * HOUR, new Set(["trend:temp:shelly:b"])).length, 1);
});

test("Vorwochen-Vergleich, Aufraeumen und Speichern", () => {
  const st = newHealthStore();
  for (let d = 0; d < 4; d++) camHour(st, T0 + d * DAY, 1);
  camHour(st, T0 + 4 * DAY, 5);
  const now = T0 + 4 * DAY + HOUR;
  const s = trendSummary(st, now);
  assert.equal(s.flakiest[0].drops24h, 5);
  assert.equal(s.flakiest[0].dropsPerDayBefore, 1.3);
  assert.match(assessTrends(st, now)[0].title, /nimmt zu/);
  assert.match(trendSummaryText(s), /Kamera Seilbahn B: 5 Aussetzer/);

  const copy = reviveHealthStore(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(copy, st);
  assert.deepEqual(reviveHealthStore({ v: 99 }), newHealthStore());
  pruneHealthStore(copy, T0 + 20 * DAY);
  assert.deepEqual(copy.links, {});
});

test("Viele Geraete gleichzeitig: eine Sammelmeldung", () => {
  const st = newHealthStore();
  for (let c = 0; c < 6; c++) {
    for (let i = 0; i < 1800; i++) {
      const failing = i % 300 < 5;
      recordLink(st, `cam:${c}`, `Kamera ${c}`, "camera", !failing, T0 + i * 2000);
    }
  }
  const f = assessTrends(st, T0 + HOUR);
  assert.equal(f.length, 1);
  assert.equal(f[0].key, "trend:link:many");
  assert.match(f[0].title, /6 von 6 Geräten/);
});
