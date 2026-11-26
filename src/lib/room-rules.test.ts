import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionSucceeded,
  allowedIntervals,
  allowedOccurrences,
  hubRunOccurrence,
  isDark,
  planFireWindows,
  ruleAllows,
  triggerOptionsFor,
  type RuleConditions,
  type RuleContext,
} from "./room-rules";
import type { ScheduleSpec } from "./operating-hours";
import { occurrencesAround, occurrencesBetween } from "./rule-due";

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

// ─── Termine von Zeit-Regeln ────────────────────────────────────────────────

const ENV = { timezone: TZ, latitude: LAT, longitude: LON, schedule: null };

test("Bedingungen gelten zur Soll-Zeit, nicht zur Zeit des Nachholens", () => {
  // 18:00 Berlin am Mittwoch, 01.07.2026 (MESZ); Fenster bis 18:10.
  const rule = { trigger: "TIME", timeOfDay: "18:00", offsetMinutes: 0 };
  const mitFenster = regel({ windowStart: "17:00", windowEnd: "18:10" });
  const now = new Date("2026-07-01T16:25:00Z"); // 18:25, nach dem Fenster
  const occ = allowedOccurrences({ ...mitFenster, trigger: "TIME" }, ENV, occurrencesAround(rule, ENV, now));
  assert.ok(occ.some((o) => o.at.toISOString() === "2026-07-01T16:00:00.000Z"));
  // Nur mittwochs: Donnerstag und Dienstag fallen weg.
  const nurMittwoch = regel({ daysOfWeek: 1 << 2 });
  const tage = allowedOccurrences({ ...nurMittwoch, trigger: "TIME" }, ENV, occurrencesAround(rule, ENV, now)).map((o) => o.ymd);
  assert.deepEqual(tage, ["2026-07-01"]);
});

test("Lauf vom Hub gehoert zum Termin laut Plan, sonst zur Zeit des Laufs", () => {
  const rule = { trigger: "TIME", timeOfDay: "18:00", offsetMinutes: 0 };
  const occ = occurrencesBetween(rule, ENV, new Date("2026-06-30T00:00:00Z"), new Date("2026-07-02T23:00:00Z"));
  const termin = hubRunOccurrence(occ, new Date("2026-07-01T16:02:40Z"), new Date("2026-07-01T16:00:00Z"));
  assert.equal(termin?.at.toISOString(), "2026-07-01T16:00:00.000Z");
  // Aelterer Hub ohne Plan-Termin: die Zeit des Laufs zaehlt.
  assert.equal(hubRunOccurrence(occ, new Date("2026-07-01T16:01:00Z"), null)?.ymd, "2026-07-01");
  // Weit weg von jedem Termin: keiner.
  assert.equal(hubRunOccurrence(occ, new Date("2026-07-01T10:00:00Z"), null), null);
});

test("Lauf vom Hub zu einem Sonnen-Termin: der Plan rundet auf die Minute, auch vor die Soll-Zeit", () => {
  const rule = { trigger: "SUNSET", timeOfDay: null, offsetMinutes: 0 };
  const from = new Date("2026-06-30T00:00:00Z");
  const end = new Date("2026-07-03T00:00:00Z");
  const occ = occurrencesBetween(rule, ENV, from, end);
  assert.ok(occ.length >= 3);
  for (const o of occ) {
    // 20 s vor der Soll-Zeit (Plan gerundet), Lauf eine Minute spaeter.
    const fireAt = new Date(o.at.getTime() - 20_000);
    assert.equal(hubRunOccurrence(occ, new Date(fireAt.getTime() + 60_000), fireAt)?.at.getTime(), o.at.getTime());
  }
  // So steht der Termin im Plan des Hubs: Er gehoert zu seinem Termin.
  const { fireAt } = planFireWindows({ ...regel(), ...rule }, ENV, from, end);
  assert.equal(fireAt.length, occ.length);
  fireAt.forEach((at, i) => assert.equal(hubRunOccurrence(occ, new Date(Date.parse(at) + 90_000), new Date(at))?.ymd, occ[i].ymd));
});

// ─── Wochentag bei Nacht-Fenstern und Betriebsende nach Mitternacht ─────────

// 28.11.2026 ist ein Samstag (MEZ, UTC+1).
const SAMSTAG = 1 << 5;
const SONNTAG = 1 << 6;

test("nur Samstag 22–8 Uhr gilt fuer die Nacht von Samstag auf Sonntag", () => {
  const nacht = regel({ daysOfWeek: SAMSTAG, windowStart: "22:00", windowEnd: "08:00" });
  assert.equal(ruleAllows(nacht, ctx("2026-11-28T22:00:00Z")), true, "Sa 23:00");
  assert.equal(ruleAllows(nacht, ctx("2026-11-29T01:00:00Z")), true, "So 02:00");
  assert.equal(ruleAllows(nacht, ctx("2026-11-29T06:59:00Z")), true, "So 07:59");
  assert.equal(ruleAllows(nacht, ctx("2026-11-29T07:00:00Z")), false, "So 08:00, Fenster zu Ende");
  assert.equal(ruleAllows(nacht, ctx("2026-11-28T01:00:00Z")), false, "Sa 02:00 gehoert zur Freitagnacht");
  assert.equal(ruleAllows(nacht, ctx("2026-11-29T22:00:00Z")), false, "So 23:00 gehoert zur Sonntagnacht");
});

test("Fenster ohne Mitternacht: Wochentag bleibt der Kalendertag", () => {
  const tags = regel({ daysOfWeek: SAMSTAG, windowStart: "10:00", windowEnd: "18:00" });
  assert.equal(ruleAllows(tags, ctx("2026-11-28T11:00:00Z")), true, "Sa 12:00");
  assert.equal(ruleAllows(tags, ctx("2026-11-29T11:00:00Z")), false, "So 12:00");
  const ohne = regel({ daysOfWeek: SONNTAG });
  assert.equal(ruleAllows(ohne, ctx("2026-11-29T01:00:00Z")), true, "So 02:00 ohne Fenster ist Sonntag");
});

test("Plan fuer den Hub: nur Samstag 22–8 ergibt Samstag 22 Uhr bis Sonntag 8 Uhr", () => {
  const nacht = regel({ daysOfWeek: SAMSTAG, windowStart: "22:00", windowEnd: "08:00" });
  const intervals = allowedIntervals(
    nacht,
    ENV,
    new Date("2026-11-27T23:00:00Z"), // Sa 00:00
    new Date("2026-11-30T23:00:00Z"), // Di 00:00
  );
  assert.deepEqual(intervals, [{ from: "2026-11-28T21:00:00.000Z", to: "2026-11-29T07:00:00.000Z" }]);
});

test("Betriebsende nach Mitternacht zaehlt fuer den Wochentag des Betriebstags", () => {
  // Samstags 18:00 bis 02:00; Betriebsende am Sonntag 02:00 (01:00 UTC).
  const spaet: ScheduleSpec = {
    name: "Spaet",
    seasons: [{ name: "Ganzjährig", startMmDd: "01-01", endMmDd: "12-31", sortOrder: 0, periods: [{ weekday: 5, opensAt: "18:00", closesAt: "02:00" }] }],
    exceptions: [],
  };
  const env = { ...ENV, schedule: spaet };
  const rule = { trigger: "CLOSING", timeOfDay: null, offsetMinutes: 0 };
  const occ = occurrencesAround(rule, env, new Date("2026-11-29T01:02:00Z")).filter((o) => o.at.toISOString() === "2026-11-29T01:00:00.000Z");
  assert.equal(occ.length, 1);
  assert.deepEqual(allowedOccurrences({ ...regel({ daysOfWeek: SAMSTAG }), trigger: "CLOSING" }, env, occ).length, 1, "nur Samstag");
  assert.deepEqual(allowedOccurrences({ ...regel({ daysOfWeek: SONNTAG }), trigger: "CLOSING" }, env, occ).length, 0, "nur Sonntag");
  // Ein Uhrzeit-Termin um 02:00 am Sonntag bleibt Sonntag.
  const time = occurrencesAround({ trigger: "TIME", timeOfDay: "02:00", offsetMinutes: 0 }, ENV, new Date("2026-11-29T01:02:00Z"))
    .filter((o) => o.ymd === "2026-11-29");
  assert.equal(allowedOccurrences({ ...regel({ daysOfWeek: SONNTAG }), trigger: "TIME" }, ENV, time).length, 1);
});

// ─── Erfolg einer Geraete-Aktion ────────────────────────────────────────────

test("actionSucceeded: angenommen nur ohne Fehler und, bei Fernbefehl, mit sent", () => {
  assert.equal(actionSucceeded("SHELLY", { sent: true }), true);
  assert.equal(actionSucceeded("SHELLY", { sent: false }), false, "Relais nicht erreicht");
  assert.equal(actionSucceeded("GARDENA_VALVE", { sent: false }), false);
  assert.equal(actionSucceeded("NUKI_SMARTLOCK", { sent: false }), false);
  assert.equal(actionSucceeded("SHELLY", { sent: true, error: "Antrieb blockiert" }), false);
  // Hue: Auftrag an den Hub angelegt.
  assert.equal(actionSucceeded("HUE_LIGHT", { sent: true }), true);
  // Pi holt den Auftrag selbst ab: sent ist dort immer falsch.
  assert.equal(actionSucceeded("RASPBERRY_PI", { sent: false }), true);
  assert.equal(actionSucceeded("RASPBERRY_PI", { sent: false, error: "Gerät fehlt" }), false);
});

// ─── Selbstabschaltung ──────────────────────────────────────────────────────

test("triggerOptionsFor: GARDENA bekommt die Laufzeit, Shelly-Schalter und -Licht den Timer im Gerät", () => {
  assert.deepEqual(triggerOptionsFor({ type: "SHELLY", category: "BELEUCHTUNG" }, 300, "open"), { autoOffSec: 300 });
  assert.deepEqual(triggerOptionsFor({ type: "SHELLY", category: "SCHALTER" }, 60, "open"), { autoOffSec: 60 });
  assert.deepEqual(triggerOptionsFor({ type: "GARDENA_VALVE", category: null }, 600, "open"), { seconds: 600 });
  assert.deepEqual(triggerOptionsFor({ type: "SHELLY", category: "BELEUCHTUNG" }, null, "open"), {}, "ohne Wert");
  assert.deepEqual(triggerOptionsFor({ type: "GARDENA_VALVE", category: null }, null, "open"), {}, "ohne Wert");
});

test("triggerOptionsFor: kein Regel-Timer bei Impulsen, Antrieben, Hue und NOT-AUF", () => {
  // Tür, Drehkreuz, Taster und Shellys ohne Kategorie schalten ihren festen Impuls.
  for (const category of ["TUER", "DREHKREUZ", "TASTER", null]) {
    assert.deepEqual(triggerOptionsFor({ type: "SHELLY", category }, 600, "open"), {}, String(category));
  }
  // Ein Antrieb kennt seine Laufzeit selbst.
  assert.deepEqual(triggerOptionsFor({ type: "SHELLY", category: "ROLLTOR" }, 600, "open"), {});
  assert.deepEqual(triggerOptionsFor({ type: "SHELLY", category: "MARKISE" }, 600, "close"), {});
  // Hue hat keinen Timer.
  assert.deepEqual(triggerOptionsFor({ type: "HUE_LIGHT", category: "BELEUCHTUNG" }, 600, "open"), {});
  // NOT-AUF hält dauerhaft offen, Ausschalten braucht keinen Timer.
  assert.deepEqual(triggerOptionsFor({ type: "SHELLY", category: "BELEUCHTUNG" }, 600, "emergency"), {});
  assert.deepEqual(triggerOptionsFor({ type: "SHELLY", category: "BELEUCHTUNG" }, 600, "reset"), {});
  // Andere Geräte werteten die Zahl nie aus.
  assert.deepEqual(triggerOptionsFor({ type: "RASPBERRY_PI", category: null }, 600, "open"), {});
  assert.deepEqual(triggerOptionsFor({ type: "NUKI_SMARTLOCK", category: null }, 600, "open"), {});
});
