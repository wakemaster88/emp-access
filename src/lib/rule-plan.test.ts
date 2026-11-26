import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedExactIntervals,
  allowedIntervals,
  allowedOccurrences,
  planFireTimes,
  planFireWindows,
  ruleAllows,
  type RuleConditions,
  type RuleContext,
} from "./room-rules";
import { conditionChangePoints, rasterIntervals, PLAN_STEP_MS, type PlanInterval } from "./rule-plan";
import { allowedAt } from "./rule-executor";
import { dueOperatingOccurrence, isOperatingAt, type ScheduleSpec } from "./operating-hours";
import { RULE_CATCH_UP_MS, occurrencesBetween, type OccurrenceEnv, type TimedRuleSpec } from "./rule-due";
import { getSunTimesForAccount } from "./sun";
import { isWithinWindow, tzInstant, tzWeekdayBit, tzYmd } from "./tz-time";

const TZ = "Europe/Berlin";
const HOURS = 48;
const FIRE_WINDOW_MS = 3 * 60_000;

// ─── Bisherige Rechnung, als Vergleich ──────────────────────────────────────

/** Bisher: alle zwei Minuten ab `from` abgetastet (frueher `allowedIntervals` in room-rules.ts). */
function sampledIntervals(allows: (at: Date) => boolean, from: Date, end: Date): PlanInterval[] {
  const out: PlanInterval[] = [];
  let open: number | null = null;
  for (let t = from.getTime(); t <= end.getTime(); t += PLAN_STEP_MS) {
    const ok = allows(new Date(t));
    if (ok && open === null) open = t;
    if (!ok && open !== null) {
      out.push({ from: new Date(open).toISOString(), to: new Date(t).toISOString() });
      open = null;
    }
  }
  if (open !== null) out.push({ from: new Date(open).toISOString(), to: end.toISOString() });
  return out;
}

/** Bedingungen wie vor der Termin-Rechnung je Tag: Wochentag immer der Kalendertag. */
function calendarDayAllows(rule: RuleConditions, ctx: RuleContext): boolean {
  if (((rule.daysOfWeek >> tzWeekdayBit(ctx.now, ctx.timezone)) & 1) !== 1) return false;
  if (rule.windowStart && rule.windowEnd && !isWithinWindow(ctx.now, rule.windowStart, rule.windowEnd, ctx.timezone)) {
    return false;
  }
  if (rule.operating !== "ANY") {
    const open = isOperatingAt(ctx.schedule, ctx.now, ctx.timezone);
    if (rule.operating === "OPEN" && !open) return false;
    if (rule.operating === "CLOSED" && open) return false;
  }
  if (rule.onlyWhenDark) {
    const { sunrise, sunset } = getSunTimesForAccount(ctx.latitude, ctx.longitude, ctx.now);
    if (!sunrise || !sunset || !(ctx.now < sunrise || ctx.now > sunset)) return false;
  }
  return true;
}

/**
 * Bisher, vor der Termin-Rechnung je Tag (rule-due.ts): alle zwei Minuten
 * den Termin des Tages gesucht, hoechstens drei Minuten entfernt. Der Termin
 * haengt nicht von den Bedingungen ab; die prueft `steppedFireTimes` danach
 * zur Soll-Zeit.
 */
function steppedCandidates(rule: TimedRuleSpec, env: OccurrenceEnv, from: Date, end: Date): number[] {
  const found = new Set<number>();
  for (let t = from.getTime(); t <= end.getTime(); t += PLAN_STEP_MS) {
    const now = new Date(t);
    let at: Date | null = null;
    if (rule.trigger === "TIME") {
      at = rule.timeOfDay ? tzInstant(tzYmd(now, env.timezone), rule.timeOfDay, env.timezone) : null;
    } else if (rule.trigger === "OPENING" || rule.trigger === "CLOSING") {
      at = env.schedule
        ? dueOperatingOccurrence(
            env.schedule,
            { kind: rule.trigger === "OPENING" ? "open" : "close", offsetMinutes: rule.offsetMinutes, daysOfWeek: 127 },
            now,
            env.timezone,
            { beforeMs: FIRE_WINDOW_MS, afterMs: FIRE_WINDOW_MS },
          )?.at ?? null
        : null;
    } else {
      const sun = getSunTimesForAccount(env.latitude, env.longitude, now);
      const base = rule.trigger === "SUNRISE" ? sun.sunrise : sun.sunset;
      at = base ? new Date(base.getTime() + rule.offsetMinutes * 60_000) : null;
    }
    if (!at || at.getTime() < from.getTime() || at.getTime() > end.getTime()) continue;
    if (Math.abs(at.getTime() - t) > FIRE_WINDOW_MS) continue;
    found.add(at.getTime());
  }
  return [...found];
}

/** Bisher: Bedingungen zur Soll-Zeit, Zeitpunkt auf die Minute gerundet. */
function steppedFireTimes(rule: RuleConditions, env: OccurrenceEnv, candidates: number[]): string[] {
  const fireAt = new Set<string>();
  for (const at of candidates) {
    if (!calendarDayAllows(rule, { ...env, now: new Date(at) })) continue;
    fireAt.add(new Date(Math.round(at / 60_000) * 60_000).toISOString());
  }
  return [...fireAt].sort();
}

// ─── Faelle ─────────────────────────────────────────────────────────────────

/** Mo–Fr 07–12 und 14–22:30, Sa 18–02 (ueber Mitternacht), So 01:30–03:30 (in der Umstellungsstunde). */
function verwinkelt(): ScheduleSpec {
  const werktags = [0, 1, 2, 3, 4].flatMap((weekday) => [
    { weekday, opensAt: "07:00", closesAt: "12:00" },
    { weekday, opensAt: "14:00", closesAt: "22:30" },
  ]);
  return {
    name: "Verwinkelt",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [
          ...werktags,
          { weekday: 5, opensAt: "18:00", closesAt: "02:00" },
          { weekday: 6, opensAt: "01:30", closesAt: "03:30" },
        ],
      },
    ],
    exceptions: [
      { date: "2027-03-28", closed: false, opensAt: "02:00", closesAt: "04:00" },
      { date: "2027-10-31", closed: false, opensAt: "02:15", closesAt: "02:45" },
      { date: "2026-11-30", closed: true, opensAt: null, closesAt: null },
    ],
  };
}

/** Taeglich 10–20 Uhr, im Winter (ab 1.11.) 11–17 Uhr. */
function saisonal(): ScheduleSpec {
  const days = [0, 1, 2, 3, 4, 5, 6];
  return {
    name: "Saisonal",
    seasons: [
      { name: "Sommer", startMmDd: "03-28", endMmDd: "10-31", sortOrder: 0, periods: days.map((weekday) => ({ weekday, opensAt: "10:00", closesAt: "20:00" })) },
      { name: "Winter", startMmDd: "11-01", endMmDd: "03-27", sortOrder: 1, periods: days.map((weekday) => ({ weekday, opensAt: "11:00", closesAt: "17:00" })) },
    ],
    exceptions: [],
  };
}

const SCHEDULES: Array<[string, ScheduleSpec | null]> = [
  ["ohne Betriebszeit", null],
  ["verwinkelt", verwinkelt()],
  ["saisonal", saisonal()],
];

/** Beginn der 48 Stunden: krumme Sekunden wie bei `new Date()`, ueber beide Zeitumstellungen, Mitternacht. */
const STARTS = [
  "2027-03-26T22:59:17.123Z", // Sa 27.03. 00:59, Sommerzeit ab So 28.03.
  "2027-10-29T23:01:00.000Z", // Sa 30.10. 00:01, Winterzeit ab So 31.10.
  "2026-11-27T23:00:00.000Z", // Sa 28.11. 00:00
  "2027-06-19T21:59:59.999Z", // kurze Nacht
  "2026-12-21T11:11:11.111Z", // lange Nacht
];

const DAYS = [127, 1 << 5, 31, 1 << 6];
const WINDOWS: Array<[string | null, string | null]> = [
  [null, null],
  ["22:00", "08:00"],
  ["10:00", "18:00"],
  ["02:30", "03:15"],
  ["01:00", "02:30"],
  ["07:13", "07:14"],
  ["12:00", "12:00"],
  ["23:59", "00:01"],
];
const OPERATING: Array<RuleConditions["operating"]> = ["ANY", "OPEN", "CLOSED"];

function allConditions(): RuleConditions[] {
  const out: RuleConditions[] = [];
  for (const daysOfWeek of DAYS) {
    for (const [windowStart, windowEnd] of WINDOWS) {
      for (const operating of OPERATING) {
        for (const onlyWhenDark of [false, true]) out.push({ daysOfWeek, windowStart, windowEnd, operating, onlyWhenDark });
      }
    }
  }
  return out;
}

function env(schedule: ScheduleSpec | null): OccurrenceEnv {
  return { timezone: TZ, latitude: 51.9, longitude: 8.3, schedule };
}

function label(rule: object): string {
  return JSON.stringify(rule);
}

// ─── Ereignis-Regeln: erlaubte Zeitraeume ───────────────────────────────────

test("Plan: erlaubte Zeitraeume gleichen dem Abtasten alle zwei Minuten, 48 Stunden, auch ueber die Zeitumstellung", () => {
  const conditions = allConditions();
  let compared = 0;
  STARTS.forEach((start, si) => {
    const from = new Date(start);
    const end = new Date(from.getTime() + HOURS * 3_600_000);
    SCHEDULES.forEach(([name, schedule], ci) => {
      const e = env(schedule);
      // Jede vierte Kombination je Start und Betriebszeit, versetzt: alle kommen vor, die Laufzeit bleibt klein.
      conditions.forEach((rule, ri) => {
        if ((ri + si + ci) % 4 !== 0) return;
        const before = sampledIntervals((at) => ruleAllows(rule, { ...e, now: at }), from, end);
        assert.deepEqual(allowedIntervals(rule, e, from, end), before, `${start} ${name} ${label(rule)}`);
        compared++;
      });
    });
  });
  assert.ok(compared > 700, `${compared} Vergleiche`);
});

test("Plan: Wochentag und Fenster ueber Mitternacht an beiden Umstellungs-Naechten, alle Kombinationen", () => {
  for (const start of [STARTS[0], STARTS[1]]) {
    const from = new Date(start);
    const end = new Date(from.getTime() + HOURS * 3_600_000);
    for (const rule of allConditions().filter((r) => r.operating === "ANY" && !r.onlyWhenDark)) {
      const e = env(null);
      const before = sampledIntervals((at) => ruleAllows(rule, { ...e, now: at }), from, end);
      assert.deepEqual(allowedIntervals(rule, e, from, end), before, `${start} ${label(rule)}`);
    }
  }
});

test("Plan: Dunkelheit kippt bei einem Standort weit im Westen um Mitternacht UTC, wie beim Abtasten", () => {
  // Sonnenuntergang dort erst nach Mitternacht UTC: `isDark` wechselt mit dem UTC-Tag.
  const e = { timezone: TZ, latitude: 37.8, longitude: -122.4, schedule: null };
  const dunkel: RuleConditions = { daysOfWeek: 127, windowStart: null, windowEnd: null, operating: "ANY", onlyWhenDark: true };
  for (const start of STARTS) {
    const from = new Date(start);
    const end = new Date(from.getTime() + HOURS * 3_600_000);
    const before = sampledIntervals((at) => ruleAllows(dunkel, { ...e, now: at }), from, end);
    assert.deepEqual(allowedIntervals(dunkel, e, from, end), before, start);
  }
});

test("Plan: statt 1 441 Auswertungen je Regel nur wenige Wechselstellen in 48 Stunden", () => {
  const from = new Date(STARTS[0]);
  const end = new Date(from.getTime() + HOURS * 3_600_000);
  const rule: RuleConditions = { daysOfWeek: 31, windowStart: "22:00", windowEnd: "08:00", operating: "OPEN", onlyWhenDark: true };
  const points = conditionChangePoints(rule, env(verwinkelt()), from, end);
  assert.ok(points.length < 40, `${points.length} Stellen`);
  assert.ok(points.every((t, i) => i === 0 || points[i - 1] < t), "aufsteigend, ohne Doppelte");
  assert.ok(points.every((t) => t > from.getTime() && t <= end.getTime()), "im Zeitraum");
});

test("Plan: Sommerzeit-Beginn verschiebt ein Fenster 02:30–03:15 auf die Umstellung", () => {
  // In der Nacht zum 28.03.2027 springt die Uhr um 02:00 (01:00 UTC) auf 03:00.
  const from = new Date("2027-03-27T23:00:00.000Z");
  const end = new Date("2027-03-28T05:00:00.000Z");
  const rule: RuleConditions = { daysOfWeek: 127, windowStart: "02:30", windowEnd: "03:15", operating: "ANY", onlyWhenDark: false };
  assert.deepEqual(allowedIntervals(rule, env(null), from, end), [
    { from: "2027-03-28T01:00:00.000Z", to: "2027-03-28T01:16:00.000Z" },
  ]);
});

test("Plan: Winterzeit-Beginn: die doppelte Stunde liegt zweimal im Fenster", () => {
  // Am 31.10.2027 laeuft 02:00–03:00 zweimal: 00:00–01:00 UTC und 01:00–02:00 UTC.
  const from = new Date("2027-10-30T22:00:00.000Z");
  const end = new Date("2027-10-31T04:00:00.000Z");
  const rule: RuleConditions = { daysOfWeek: 127, windowStart: "02:30", windowEnd: "03:15", operating: "ANY", onlyWhenDark: false };
  assert.deepEqual(allowedIntervals(rule, env(null), from, end), [
    { from: "2027-10-31T00:30:00.000Z", to: "2027-10-31T01:00:00.000Z" },
    { from: "2027-10-31T01:30:00.000Z", to: "2027-10-31T02:16:00.000Z" },
  ]);
});

test("Raster: ein Abschnitt zwischen zwei Rasterstellen faellt weg wie beim Abtasten", () => {
  const from = 0;
  const step = PLAN_STEP_MS;
  // Erlaubt nur von 61 s bis 119 s: keine Rasterstelle (0, 120 s, 240 s) trifft das.
  const points = [
    { at: 0, ok: false },
    { at: 61_000, ok: true },
    { at: 119_000, ok: false },
    { at: 200_000, ok: true },
  ];
  assert.deepEqual(rasterIntervals(points, from, 600_000, step), [
    { from: new Date(240_000).toISOString(), to: new Date(600_000).toISOString() },
  ]);
});

// ─── Zeit-Regeln: Zeitpunkte ────────────────────────────────────────────────

/**
 * Faelle, deren Bedeutung die Termin-Rechnung je Tag nicht geaendert hat:
 * Fenster ohne Mitternacht oder alle Wochentage, Sonnenzeiten mit Versatz
 * bis zwei Stunden, Betriebsende vor Mitternacht oder alle Wochentage. Die bewusst
 * geaenderten Faelle (Betriebstag, Nacht ab Samstag, grosser Versatz) halten
 * room-rules.test.ts und rule-due.test.ts fest.
 */
const TIMED_SPECS: TimedRuleSpec[] = [
  ...["07:00", "07:13", "00:00", "23:59", "02:30", "12:00"].map((timeOfDay) => ({ trigger: "TIME", timeOfDay, offsetMinutes: 0 })),
  ...["SUNRISE", "SUNSET"].flatMap((trigger) => [-60, 0, 45, 120].map((offsetMinutes) => ({ trigger, timeOfDay: null, offsetMinutes }))),
  ...["OPENING", "CLOSING"].flatMap((trigger) => [-30, 15].map((offsetMinutes) => ({ trigger, timeOfDay: null, offsetMinutes }))),
];

const TIMED_CONDITIONS: RuleConditions[] = [
  { daysOfWeek: 127, windowStart: null, windowEnd: null, operating: "ANY", onlyWhenDark: false },
  { daysOfWeek: 31, windowStart: null, windowEnd: null, operating: "ANY", onlyWhenDark: false },
  { daysOfWeek: 1 << 6, windowStart: "06:00", windowEnd: "21:00", operating: "ANY", onlyWhenDark: false },
  { daysOfWeek: 127, windowStart: "22:00", windowEnd: "08:00", operating: "ANY", onlyWhenDark: false },
  { daysOfWeek: 127, windowStart: null, windowEnd: null, operating: "OPEN", onlyWhenDark: false },
  { daysOfWeek: 127, windowStart: null, windowEnd: null, operating: "CLOSED", onlyWhenDark: true },
];

/** Betriebsende nach Mitternacht zaehlt inzwischen fuer den Betriebstag; mit Wochentag-Auswahl nicht vergleichbar. */
function comparable(rule: RuleConditions & TimedRuleSpec, scheduleName: string): boolean {
  if (rule.daysOfWeek === 127) return true;
  return !(rule.trigger === "CLOSING" && scheduleName === "verwinkelt");
}

test("Plan: Zeitpunkte der Zeit-Regeln gleichen der Suche alle zwei Minuten, 48 Stunden, auch ueber die Zeitumstellung", () => {
  let compared = 0;
  let fired = 0;
  for (const start of STARTS) {
    const from = new Date(start);
    const end = new Date(from.getTime() + HOURS * 3_600_000);
    for (const spec of TIMED_SPECS) {
      const byOperating = spec.trigger === "OPENING" || spec.trigger === "CLOSING";
      // Uhrzeit und Sonne haengen nicht von der Betriebszeit ab: einmal je Start suchen.
      const shared = byOperating ? null : steppedCandidates(spec, env(null), from, end);
      for (const [name, schedule] of SCHEDULES) {
        if (byOperating && !schedule) continue;
        const e = env(schedule);
        const candidates = shared ?? steppedCandidates(spec, e, from, end);
        for (const conditions of TIMED_CONDITIONS) {
          const rule = { ...conditions, ...spec };
          if (!comparable(rule, name)) continue;
          const now = planFireTimes(rule, e, from, end);
          assert.deepEqual(now, steppedFireTimes(rule, e, candidates), `${start} ${name} ${label(rule)}`);
          compared++;
          fired += now.length;
        }
      }
    }
  }
  assert.ok(compared > 1000 && fired > 1000, `${compared} Vergleiche, ${fired} Zeitpunkte`);
});

test("Plan: Nachholfrist je Termin fuer den Notbetrieb, hoechstens 30 Minuten nach dem Termin", () => {
  let checked = 0;
  for (const start of STARTS) {
    const from = new Date(start);
    const end = new Date(from.getTime() + HOURS * 3_600_000);
    for (const spec of TIMED_SPECS) {
      for (const [, schedule] of SCHEDULES) {
        if ((spec.trigger === "OPENING" || spec.trigger === "CLOSING") && !schedule) continue;
        const rule = { ...TIMED_CONDITIONS[0], ...spec };
        const { fireAt, fireUntil } = planFireWindows(rule, env(schedule), from, end);
        assert.deepEqual(fireAt, planFireTimes(rule, env(schedule), from, end));
        assert.equal(fireUntil.length, fireAt.length);
        // Erwartet: das Ende der Nachholfrist des Termins, bei zwei Terminen
        // in derselben Minute das spaetere.
        const expected = new Map<string, number>();
        for (const occ of allowedOccurrences(rule, env(schedule), occurrencesBetween(rule, env(schedule), from, end))) {
          const at = new Date(Math.round(occ.at.getTime() / 60_000) * 60_000).toISOString();
          expected.set(at, Math.max(expected.get(at) ?? 0, occ.until.getTime()));
        }
        for (let i = 0; i < fireAt.length; i++) {
          const span = Date.parse(fireUntil[i]) - Date.parse(fireAt[i]);
          // Gerundet auf die Minute: bis 30 s Abweichung von der Soll-Zeit.
          assert.ok(span > 0 && span <= RULE_CATCH_UP_MS + 30_000, `${start} ${label(rule)} ${fireAt[i]} ${fireUntil[i]}`);
          assert.equal(Date.parse(fireUntil[i]), expected.get(fireAt[i]), `${start} ${label(rule)} ${fireAt[i]}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 100, `${checked} Termine`);
});

test("Plan ohne Raster (Bewegung direkt vom Hub): zu jeder Zeit wie ruleAllows, auch an jeder Wechselstelle", () => {
  const conditions = allConditions();
  let checked = 0;
  STARTS.forEach((start, si) => {
    const from = new Date(start);
    const end = new Date(from.getTime() + HOURS * 3_600_000);
    SCHEDULES.forEach(([name, schedule], ci) => {
      const e = env(schedule);
      conditions.forEach((rule, ri) => {
        if ((ri + si + ci) % 8 !== 0) return;
        const intervals = allowedExactIntervals(rule, e, from, end);
        const probes = new Set<number>();
        for (const p of conditionChangePoints(rule, e, from, end)) for (const d of [-1, 0, 1]) probes.add(p + d);
        for (let t = from.getTime(); t < end.getTime(); t += 7 * 60_000 + 13_000) probes.add(t);
        for (const t of probes) {
          if (t < from.getTime() || t >= end.getTime()) continue;
          const now = new Date(t);
          assert.equal(allowedAt(intervals, t), ruleAllows(rule, { ...e, now }), `${start} ${name} ${label(rule)} ${now.toISOString()}`);
          checked++;
        }
      });
    });
  });
  assert.ok(checked > 10_000, `${checked} Stellen`);
});
