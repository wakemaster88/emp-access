import { test } from "node:test";
import assert from "node:assert/strict";
import { climateDecision, climateTarget, inAfterrun, statusUpdatedAt, ventDecision } from "./room-climate";
import type { ScheduleSpec } from "./operating-hours";

const base = { fresh: true, targetC: 21, hysteresisC: 0.5, heating: false as boolean | null };

test("heizt unter Soll minus Spielraum, aus über Soll plus Spielraum", () => {
  assert.equal(climateDecision({ ...base, tempC: 20.4 }).heat, true);
  assert.equal(climateDecision({ ...base, tempC: 21.6, heating: true }).heat, false);
});

test("im Sollbereich bleibt der letzte Zustand", () => {
  assert.equal(climateDecision({ ...base, tempC: 21.2, heating: true }).heat, true);
  assert.equal(climateDecision({ ...base, tempC: 20.8, heating: false }).heat, false);
  // Erster Lauf ohne Zustand: unter Soll heizen.
  assert.equal(climateDecision({ ...base, tempC: 20.8, heating: null }).heat, true);
});

test("ohne oder mit altem Messwert: Heizung aus und Fehler", () => {
  const none = climateDecision({ ...base, tempC: null, heating: true });
  assert.equal(none.heat, false);
  assert.ok(none.sensorError);
  const stale = climateDecision({ ...base, tempC: 15, fresh: false, heating: true });
  assert.equal(stale.heat, false);
  assert.ok(stale.sensorError);
});

test("außerhalb der Betriebszeit ohne Absenkung: aus", () => {
  assert.equal(climateDecision({ ...base, targetC: null, tempC: 10 }).heat, false);
});

const schedule: ScheduleSpec = {
  name: "Strandbad",
  seasons: [
    {
      name: "Ganzjahr",
      startMmDd: "01-01",
      endMmDd: "12-31",
      sortOrder: 0,
      periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "10:00", closesAt: "18:00" })),
    },
  ],
  exceptions: [],
};

test("Soll folgt der Betriebszeit, mit Vorheizen und Absenkung", () => {
  const climate = { targetC: 21, setbackC: 16, preheatMinutes: 30 };
  const tz = "Europe/Berlin";
  // 4. Nov 2026, 09:40 Berlin = 08:40 UTC: Vorheizen
  assert.equal(climateTarget(climate, schedule, new Date("2026-11-04T08:40:00Z"), tz).targetC, 21);
  // 09:00 Berlin: Absenkung
  assert.equal(climateTarget(climate, schedule, new Date("2026-11-04T08:00:00Z"), tz).targetC, 16);
  // 12:00 Berlin: offen
  assert.equal(climateTarget(climate, schedule, new Date("2026-11-04T11:00:00Z"), tz).targetC, 21);
  // Ohne Absenkung nachts aus
  assert.equal(climateTarget({ ...climate, setbackC: null }, schedule, new Date("2026-11-04T22:00:00Z"), tz).targetC, null);
  // Ohne Betriebszeit immer Soll
  assert.equal(climateTarget(climate, null, new Date("2026-11-04T22:00:00Z"), tz).targetC, 21);
});

test("Heizfenster mit Vorheizen und Nachlauf: Wasserski 12–16 → 11:30–16:30", () => {
  const tz = "Europe/Berlin";
  const ski: ScheduleSpec = {
    name: "Wasserski",
    seasons: [{ name: "Ganzjahr", startMmDd: "01-01", endMmDd: "12-31", sortOrder: 0,
      periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "12:00", closesAt: "16:00" })) }],
    exceptions: [],
  };
  const c = { targetC: 22, setbackC: null, preheatMinutes: 30, afterrunMinutes: 30 };
  // November: Berlin = UTC+1
  const at = (hhmm: string) => new Date(`2026-11-04T${hhmm}:00+01:00`);
  assert.equal(climateTarget(c, ski, at("11:29"), tz).targetC, null);
  assert.equal(climateTarget(c, ski, at("11:30"), tz).targetC, 22);
  assert.equal(climateTarget(c, ski, at("16:29"), tz).targetC, 22);
  assert.equal(climateTarget(c, ski, at("16:30"), tz).targetC, null);
  // Ohne Nachlauf endet das Fenster mit der Betriebszeit
  assert.equal(climateTarget({ ...c, afterrunMinutes: 0 }, ski, at("16:10"), tz).targetC, null);
});

test("Zeitstempel aus dem Cloud-Status", () => {
  assert.equal(statusUpdatedAt({ _updated: "2026-11-04 10:12:13" })?.toISOString(), "2026-11-04T10:12:13.000Z");
  assert.equal(statusUpdatedAt({}), null);
});

const vent = { humidity: 60, tempC: 18, fresh: true, onHumidity: 65, offHumidity: 58, minTempC: 8, afterrun: false, fanOn: false as boolean | null };

test("Lüftung: an ab 65 %, aus unter 58 %, dazwischen bleibt der Zustand", () => {
  assert.equal(ventDecision({ ...vent, humidity: 65 }).on, true);
  assert.equal(ventDecision({ ...vent, humidity: 57.9, fanOn: true }).on, false);
  assert.equal(ventDecision({ ...vent, humidity: 60, fanOn: true }).on, true);
  assert.equal(ventDecision({ ...vent, humidity: 60, fanOn: false }).on, false);
});

test("Lüftung: Nachlauf nach Betriebsende, Frostschutz geht vor", () => {
  assert.equal(ventDecision({ ...vent, humidity: 40, afterrun: true }).on, true);
  assert.equal(ventDecision({ ...vent, humidity: 80, tempC: 7.5 }).on, false);
  assert.equal(ventDecision({ ...vent, afterrun: true, tempC: 7.5 }).on, false);
  assert.equal(ventDecision({ ...vent, humidity: 80, fresh: false }).on, false);
});

test("Nachlauf-Fenster: 16:00 Schluss, 45 Min. → bis 16:45, nicht während des Betriebs", () => {
  const tz = "Europe/Berlin";
  const ski: ScheduleSpec = {
    name: "Wasserski",
    seasons: [{ name: "Ganzjahr", startMmDd: "01-01", endMmDd: "12-31", sortOrder: 0,
      periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "12:00", closesAt: "16:00" })) }],
    exceptions: [],
  };
  const at = (hhmm: string) => new Date(`2026-11-04T${hhmm}:00+01:00`);
  assert.equal(inAfterrun(ski, at("15:59"), tz, 45), false);
  assert.equal(inAfterrun(ski, at("16:00"), tz, 45), true);
  assert.equal(inAfterrun(ski, at("16:44"), tz, 45), true);
  assert.equal(inAfterrun(ski, at("16:45"), tz, 45), false);
  assert.equal(inAfterrun(ski, at("11:50"), tz, 45), false);
  assert.equal(inAfterrun(null, at("16:10"), tz, 45), false);
});

test("Uebersteuern mit Ablauf geht vor dem Plan und laeuft ab", () => {
  const tz = "Europe/Berlin";
  const climate = { targetC: 21, setbackC: 16, preheatMinutes: 30, overrideC: 23, overrideUntil: new Date("2026-11-04T08:10:00Z") };
  // 09:00 Berlin (08:00 UTC): eigentlich Absenkung, aber uebersteuert.
  const before = climateTarget(climate, schedule, new Date("2026-11-04T08:00:00Z"), tz);
  assert.equal(before.targetC, 23);
  assert.equal(before.override, true);
  // Nach dem Ablauf (09:20 Berlin, noch vor dem Vorheizen) gilt wieder der Plan.
  const after = climateTarget(climate, schedule, new Date("2026-11-04T08:20:00Z"), tz);
  assert.equal(after.targetC, 16);
  assert.equal(after.override, false);
});
