import { test } from "node:test";
import assert from "node:assert/strict";
import {
  berlinAt,
  dryWindows,
  forgottenCandidate,
  irrigationOutlook,
  mowVerdict,
  nextMowRun,
  trackForgotten,
  type DeviceView,
  type MowerTaskLite,
} from "./energy-rules.js";
import type { WeatherHour } from "../weather.js";

/** Stuendliche Werte ab `from` (UTC), Wert gilt fuer die Stunde davor. */
function hours(from: string, n: number, f: (i: number) => Partial<WeatherHour> = () => ({})): WeatherHour[] {
  const t0 = Date.parse(from);
  return Array.from({ length: n }, (_, i) => ({
    t: new Date(t0 + (i + 1) * 3_600_000).toISOString(),
    tempC: 12,
    precipMm: 0,
    precipProb: 0,
    code: 1,
    windKmh: 10,
    cloudPct: 50,
    ...f(i),
  }));
}

test("berlinAt rechnet Winter- und Sommerzeit", () => {
  assert.equal(berlinAt("2026-11-05", "20:00").toISOString(), "2026-11-05T19:00:00.000Z");
  assert.equal(berlinAt("2026-07-01", "20:00").toISOString(), "2026-07-01T18:00:00.000Z");
});

const task: MowerTaskLite = {
  mower: "Luba-VA6C39PZ",
  mowerLabel: "Luba 3 AWD",
  id: "p1",
  name: "Aufgabe-1",
  enabled: true,
  startTime: "20:00",
  endTime: "",
  weekdays: ["Di", "Do", "Sa"],
};

test("naechster Maehlauf: heute Donnerstag 20 Uhr, drei Stunden Fenster", () => {
  const now = new Date("2026-11-05T15:00:00Z"); // Do 16:00 Berlin
  const run = nextMowRun(task, now);
  assert.ok(run);
  assert.equal(run.start.toISOString(), "2026-11-05T19:00:00.000Z");
  assert.equal(run.end.toISOString(), "2026-11-05T22:00:00.000Z");
  // Nur 3 Stunden Vorlauf: um 16 Uhr ist 20 Uhr noch zu weit weg.
  assert.equal(nextMowRun(task, now, 3), null);
  assert.ok(nextMowRun(task, new Date("2026-11-05T17:30:00Z"), 3));
  // Freitag: naechster Lauf Samstag
  const fri = nextMowRun(task, new Date("2026-11-06T10:00:00Z"));
  assert.equal(fri?.start.toISOString(), "2026-11-07T19:00:00.000Z");
  assert.equal(nextMowRun({ ...task, enabled: false }, now), null);
});

test("Maeh-Urteil: Regen im Fenster, nasses Gras, Kaelte", () => {
  const start = new Date("2026-11-05T19:00:00Z");
  const end = new Date("2026-11-05T22:00:00Z");
  assert.equal(mowVerdict(hours("2026-11-05T10:00:00Z", 20), start, end).ok, true);
  const rain = hours("2026-11-05T10:00:00Z", 20, (i) => (i === 10 ? { precipMm: 1.2 } : {}));
  assert.deepEqual(mowVerdict(rain, start, end).reasons, ["1.2 mm Regen erwartet"]);
  const wet = hours("2026-11-05T10:00:00Z", 20, (i) => (i === 6 || i === 7 ? { precipMm: 1.5 } : {}));
  assert.match(mowVerdict(wet, start, end).reasons.join(), /Gras nass/);
  const cold = hours("2026-11-05T10:00:00Z", 20, () => ({ tempC: 1 }));
  assert.match(mowVerdict(cold, start, end).reasons.join(), /zu kalt/);
});

test("trockene Fenster nur tagsueber und am Stueck", () => {
  // 07:00–19:00 UTC = 08:00–20:00 Berlin; Regen 12–13 UTC
  const h = hours("2026-11-05T07:00:00Z", 12, (i) => (i === 5 ? { precipMm: 0.8 } : {}));
  const w = dryWindows(h, new Date("2026-11-05T00:00:00Z"), new Date("2026-11-06T00:00:00Z"));
  assert.deepEqual(
    w.map((x) => [x.start.toISOString(), x.end.toISOString()]),
    [
      ["2026-11-05T07:00:00.000Z", "2026-11-05T12:00:00.000Z"],
      ["2026-11-05T13:00:00.000Z", "2026-11-05T19:00:00.000Z"],
    ]
  );
});

test("Bewaesserung: Regen setzt aus, ohne Regen-Aussetzer gibt es einen Hinweis", () => {
  const plans = [
    { id: 1, name: "Rasen", startTime: "06:00", daysOfWeek: 127, durationMinutes: 15, isActive: true, skipOnRain: true, smartRain: false },
    { id: 2, name: "Beet", startTime: "07:00", daysOfWeek: 127, durationMinutes: 10, isActive: true, skipOnRain: false, smartRain: false },
    { id: 3, name: "Nur Mo", startTime: "07:00", daysOfWeek: 1, durationMinutes: 10, isActive: true, skipOnRain: true, smartRain: false },
  ];
  const day = { date: "2026-11-05", tMin: 6, tMax: 11, precipMm: 8, precipProb: 90, code: 61, sunrise: null, sunset: null };
  const out = irrigationOutlook(plans, day, "2026-11-05"); // Donnerstag
  assert.equal(out.length, 2);
  assert.equal(out[0].expect, "ausgesetzt");
  assert.equal(out[1].expect, "laeuft");
  assert.match(out[1].hint ?? "", /Bei Regen aussetzen/);
  const frost = irrigationOutlook(plans, { ...day, precipMm: 0, precipProb: 0, tMin: -2 }, "2026-11-05");
  assert.match(frost[0].hint ?? "", /Frost/);
});

const dev = (over: Partial<DeviceView> = {}): DeviceView => ({
  id: 42,
  name: "Licht Umkleide Herren",
  room: "Umkleide Herren",
  roomId: 6,
  category: "BELEUCHTUNG",
  type: "SHELLY",
  on: true,
  powerW: 60,
  roomOpen: false,
  climateManaged: false,
  ...over,
});

test("vergessene Verbraucher: nur an, Raum zu, nicht Klima, keine Dauerverbraucher", () => {
  assert.equal(forgottenCandidate(dev()), true);
  assert.equal(forgottenCandidate(dev({ roomOpen: true })), false);
  assert.equal(forgottenCandidate(dev({ roomOpen: null })), false);
  assert.equal(forgottenCandidate(dev({ on: false })), false);
  assert.equal(forgottenCandidate(dev({ climateManaged: true, category: "SCHALTER" })), false);
  assert.equal(forgottenCandidate(dev({ name: "Kühlschrank Gastro", category: "SCHALTER" })), false);
  assert.equal(forgottenCandidate(dev({ category: "TASTER" })), false);
  assert.equal(forgottenCandidate(dev({ type: "HUE_LIGHT", category: null })), true);
});

test("vergessene Verbraucher erst nach 45 Minuten am Stueck", () => {
  const track = new Map<number, number>();
  const t0 = 1_000_000;
  assert.equal(trackForgotten(track, [dev()], t0).length, 0);
  assert.equal(trackForgotten(track, [dev()], t0 + 44 * 60_000).length, 0);
  assert.equal(trackForgotten(track, [dev()], t0 + 45 * 60_000).length, 1);
  // Kurz aus → Zaehler beginnt neu
  trackForgotten(track, [dev({ on: false })], t0 + 50 * 60_000);
  assert.equal(trackForgotten(track, [dev()], t0 + 55 * 60_000).length, 0);
});
