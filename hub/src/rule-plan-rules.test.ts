import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_REFRESH_MS,
  PLAN_REFRESH_VERSIONED_MS,
  inAllowed,
  localActionOptions,
  planRefreshDue,
  type PlanRefreshState,
} from "./rule-plan-rules.js";

// Plan der Cloud fuer „nur Samstag, 22–8 Uhr“ am 28.11.2026 (MEZ), wie ihn
// src/lib/room-rules.test.ts fuer allowedIntervals festhaelt.
const SAMSTAGNACHT = [{ from: "2026-11-28T21:00:00.000Z", to: "2026-11-29T07:00:00.000Z" }];

test("inAllowed: Samstagnacht bis Sonntag 8 Uhr, nicht Samstagfrueh und nicht Sonntagabend", () => {
  assert.equal(inAllowed(SAMSTAGNACHT, Date.parse("2026-11-28T22:00:00Z")), true, "Sa 23:00");
  assert.equal(inAllowed(SAMSTAGNACHT, Date.parse("2026-11-29T01:00:00Z")), true, "So 02:00");
  assert.equal(inAllowed(SAMSTAGNACHT, Date.parse("2026-11-29T07:00:00Z")), false, "So 08:00");
  assert.equal(inAllowed(SAMSTAGNACHT, Date.parse("2026-11-28T01:00:00Z")), false, "Sa 02:00");
  assert.equal(inAllowed(SAMSTAGNACHT, Date.parse("2026-11-29T22:00:00Z")), false, "So 23:00");
});

test("inAllowed: leerer Plan erlaubt nichts", () => {
  assert.equal(inAllowed([], Date.parse("2026-11-28T22:00:00Z")), false);
});

test("localActionOptions: Notbetrieb schaltet nur im LAN und reicht die Selbstabschaltung durch", () => {
  assert.deepEqual(localActionOptions({ timerSeconds: 300 }), { localOnly: true, autoOffSec: 300 });
  assert.deepEqual(localActionOptions({ timerSeconds: null }), { localOnly: true });
  assert.deepEqual(localActionOptions({}), { localOnly: true });
});

const MIN = 60_000;
const H = 60 * MIN;

function stand(patch: Partial<PlanRefreshState> = {}): PlanRefreshState {
  return { fetchedAt: 0, attemptAt: 0, planVersion: "a1", cloudVersion: "a1", ...patch };
}

test("planRefreshDue: gleiche Version: erst nach 6 Stunden wieder", () => {
  assert.equal(planRefreshDue(stand(), 15 * MIN), false, "nach 15 Minuten nicht mehr");
  assert.equal(planRefreshDue(stand(), 6 * H - 1), false);
  assert.equal(planRefreshDue(stand(), 6 * H), true);
});

test("planRefreshDue: neue Version im Lebenszeichen: sofort", () => {
  assert.equal(planRefreshDue(stand({ cloudVersion: "b2" }), 2 * MIN), true);
  // Gerade erst versucht (gescheitert oder unterwegs): ein Lebenszeichen-Takt Abstand.
  assert.equal(planRefreshDue(stand({ cloudVersion: "b2", attemptAt: 2 * MIN }), 2 * MIN + 30_000), false);
  assert.equal(planRefreshDue(stand({ cloudVersion: "b2", attemptAt: 2 * MIN }), 3 * MIN), true);
});

test("planRefreshDue: Cloud ohne Regel-Version: weiter alle 15 Minuten", () => {
  const alt = stand({ planVersion: null, cloudVersion: null });
  assert.equal(planRefreshDue(alt, 15 * MIN - 1), false);
  assert.equal(planRefreshDue(alt, 15 * MIN), true);
  // Plan mit Version, Lebenszeichen ohne (Cloud zurueckgesetzt): ebenso.
  assert.equal(planRefreshDue(stand({ cloudVersion: null }), 15 * MIN), true);
});

test("planRefreshDue: ohne Plan oder nach Fehlern: alle 15 Minuten ein Versuch", () => {
  assert.equal(planRefreshDue(stand({ fetchedAt: null, attemptAt: null }), 0), true, "noch nie versucht");
  assert.equal(planRefreshDue(stand({ fetchedAt: null, attemptAt: 0 }), 14 * MIN), false);
  assert.equal(planRefreshDue(stand({ fetchedAt: null, attemptAt: 0 }), 15 * MIN), true);
  // Plan 6 h alt, Abruf vor 5 Minuten gescheitert: nicht jede Minute erneut.
  assert.equal(planRefreshDue(stand({ attemptAt: 6 * H }), 6 * H + 5 * MIN), false);
  assert.equal(planRefreshDue(stand({ attemptAt: 6 * H }), 6 * H + 15 * MIN), true);
});

test("planRefreshDue: zurueckgestellte Uhr holt den Plan, statt Stunden zu warten", () => {
  assert.equal(planRefreshDue(stand({ fetchedAt: 10 * H, attemptAt: 10 * H }), 8 * H), true);
});

test("planRefreshDue: bei gleicher Version reicht der Plan bei jedem Ausfallbeginn knapp 42 Stunden", () => {
  // Pruefung jede Minute wie in rules.ts; jeder faellige Abruf gelingt.
  let s = stand();
  let worst = Infinity;
  for (let now = 0; now <= 24 * H; now += MIN) {
    if (planRefreshDue(s, now)) s = { ...s, fetchedAt: now, attemptAt: now };
    // Reisst die Verbindung jetzt ab, beginnt der Notbetrieb 3 Minuten spaeter.
    worst = Math.min(worst, (s.fetchedAt ?? 0) + 48 * H - (now + 3 * MIN));
  }
  assert.equal(worst, 48 * H - PLAN_REFRESH_VERSIONED_MS - 2 * MIN);
  assert.ok(worst >= 42 * H - 3 * MIN);
  assert.ok(PLAN_REFRESH_VERSIONED_MS > PLAN_REFRESH_MS);
});
