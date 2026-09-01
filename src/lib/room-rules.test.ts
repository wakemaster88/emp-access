import assert from "node:assert/strict";
import { test } from "node:test";
import { isDark, ruleAllows, type RuleConditions, type RuleContext } from "./room-rules";
import type { ScheduleSpec } from "./operating-hours";

const TZ = "Europe/Berlin";
// Tuttenbrocksee, ungefähr.
const LAT = 51.9;
const LON = 8.3;

/** Täglich 10–20 Uhr, ganzjährig. */
function ganztags(): ScheduleSpec {
  return {
    name: "Strandbad",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          opensAt: "10:00",
          closesAt: "20:00",
        })),
      },
    ],
    exceptions: [],
  };
}

function ctx(iso: string, schedule: ScheduleSpec | null = null): RuleContext {
  return {
    now: new Date(iso),
    timezone: TZ,
    latitude: LAT,
    longitude: LON,
    schedule,
  };
}

function regel(patch: Partial<RuleConditions> = {}): RuleConditions {
  return {
    daysOfWeek: 127,
    operating: "ANY",
    windowStart: null,
    windowEnd: null,
    onlyWhenDark: false,
    ...patch,
  };
}

test("ohne Bedingungen greift die Regel immer", () => {
  assert.equal(ruleAllows(regel(), ctx("2026-07-01T12:00:00Z")), true);
});

test("Wochentage werden als Bitmaske geprüft", () => {
  // 2026-07-01 ist ein Mittwoch -> Bit 2.
  const nurMittwoch = regel({ daysOfWeek: 1 << 2 });
  assert.equal(ruleAllows(nurMittwoch, ctx("2026-07-01T12:00:00Z")), true);
  assert.equal(ruleAllows(nurMittwoch, ctx("2026-07-02T12:00:00Z")), false);

  const nurWochenende = regel({ daysOfWeek: (1 << 5) | (1 << 6) });
  assert.equal(ruleAllows(nurWochenende, ctx("2026-07-01T12:00:00Z")), false);
  // 2026-07-04 ist ein Samstag.
  assert.equal(ruleAllows(nurWochenende, ctx("2026-07-04T12:00:00Z")), true);
});

test("Wochentag richtet sich nach der Zeitzone, nicht nach UTC", () => {
  // 2026-07-01T22:30Z ist in Berlin schon Donnerstag (00:30).
  const nurDonnerstag = regel({ daysOfWeek: 1 << 3 });
  assert.equal(ruleAllows(nurDonnerstag, ctx("2026-07-01T22:30:00Z")), true);
});

test("Zeitfenster begrenzt die Regel", () => {
  const nachts = regel({ windowStart: "22:00", windowEnd: "06:00" });
  // 23:00 Berlin
  assert.equal(ruleAllows(nachts, ctx("2026-07-01T21:00:00Z")), true);
  // 03:00 Berlin – über Mitternacht
  assert.equal(ruleAllows(nachts, ctx("2026-07-01T01:00:00Z")), true);
  // 14:00 Berlin
  assert.equal(ruleAllows(nachts, ctx("2026-07-01T12:00:00Z")), false);
});

test("Bedingung „nur während der Betriebszeit“", () => {
  const nurOffen = regel({ operating: "OPEN" });
  const plan = ganztags();
  // 14:00 Berlin -> offen
  assert.equal(ruleAllows(nurOffen, ctx("2026-07-01T12:00:00Z", plan)), true);
  // 08:00 Berlin -> noch zu
  assert.equal(ruleAllows(nurOffen, ctx("2026-07-01T06:00:00Z", plan)), false);
  // 22:00 Berlin -> schon zu
  assert.equal(ruleAllows(nurOffen, ctx("2026-07-01T20:00:00Z", plan)), false);
});

test("Bedingung „nur außerhalb der Betriebszeit“", () => {
  const nurZu = regel({ operating: "CLOSED" });
  const plan = ganztags();
  assert.equal(ruleAllows(nurZu, ctx("2026-07-01T12:00:00Z", plan)), false);
  assert.equal(ruleAllows(nurZu, ctx("2026-07-01T20:00:00Z", plan)), true);
});

test("Ausnahmetag wirkt auch auf die Regel-Bedingung", () => {
  const plan = ganztags();
  plan.exceptions.push({
    date: "2026-07-01",
    closed: true,
    opensAt: null,
    closesAt: null,
    note: "Betriebsferien",
  });
  // Mitten am Tag, aber geschlossen: „nur während“ greift nicht, „nur außerhalb“ schon.
  assert.equal(ruleAllows(regel({ operating: "OPEN" }), ctx("2026-07-01T12:00:00Z", plan)), false);
  assert.equal(ruleAllows(regel({ operating: "CLOSED" }), ctx("2026-07-01T12:00:00Z", plan)), true);
});

test("ohne Betriebszeit gilt der Betrieb als offen", () => {
  // Ein Raum ohne Profil soll Regeln nicht blockieren, aber auch nicht
  // dauerhaft als geschlossen gelten.
  assert.equal(ruleAllows(regel({ operating: "OPEN" }), ctx("2026-07-01T03:00:00Z", null)), true);
  assert.equal(ruleAllows(regel({ operating: "CLOSED" }), ctx("2026-07-01T03:00:00Z", null)), false);
});

test("Bedingungen wirken zusammen, nicht alternativ", () => {
  const streng = regel({
    daysOfWeek: 1 << 2,
    operating: "CLOSED",
    windowStart: "20:00",
    windowEnd: "23:00",
  });
  const plan = ganztags();
  // Mittwoch 21:00 Berlin, Betrieb zu, im Fenster -> greift.
  assert.equal(ruleAllows(streng, ctx("2026-07-01T19:00:00Z", plan)), true);
  // Mittwoch 14:00: Betrieb offen und außerhalb des Fensters -> greift nicht.
  assert.equal(ruleAllows(streng, ctx("2026-07-01T12:00:00Z", plan)), false);
  // Donnerstag 21:00: falscher Wochentag -> greift nicht.
  assert.equal(ruleAllows(streng, ctx("2026-07-02T19:00:00Z", plan)), false);
});

test("Dunkelheit erkennt Sommernacht und Sommermittag", () => {
  // Anfang Juli in Westfalen: Sonnenuntergang gegen 21:50 Ortszeit.
  assert.equal(isDark(ctx("2026-07-01T12:00:00Z")), false, "14:00 Ortszeit ist hell");
  assert.equal(isDark(ctx("2026-07-01T23:30:00Z")), true, "01:30 Ortszeit ist dunkel");
});

test("Bedingung „nur wenn dunkel“ sperrt am Tag", () => {
  const nurDunkel = regel({ onlyWhenDark: true });
  assert.equal(ruleAllows(nurDunkel, ctx("2026-07-01T12:00:00Z")), false);
  assert.equal(ruleAllows(nurDunkel, ctx("2026-07-01T23:30:00Z")), true);
});

test("im Winter ist der Nachmittag dunkel, im Sommer nicht", () => {
  // 17:00 Ortszeit: Mitte Dezember nach Sonnenuntergang, Anfang Juli lange davor.
  assert.equal(isDark(ctx("2026-12-15T16:00:00Z")), true);
  assert.equal(isDark(ctx("2026-07-15T15:00:00Z")), false);
});
