import { test } from "node:test";
import assert from "node:assert/strict";
import { audienceMatches, audiencesFor, beachOnlySubscriptionIds, isBeachSubscription, parseAudience, passKindOf } from "./rider-pass";

// Wie in Produktion: Ride 2, Kids 5, Ride + Gear 6 am Lift, Beach Abo 1 nur Strandbad.
const cfg = { beachEnabled: true, subscriptionIds: [2, 5, 6], beachSubscriptionIds: [1] };
const now = new Date("2026-07-01T10:00:00Z");
const later = new Date("2027-07-01T00:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");

test("passKindOf: Beach Abo allein gibt den Beach Pass", () => {
  assert.equal(passKindOf([{ subscriptionId: 1, status: "VALID", endDate: later }], cfg, now), "BEACH");
});

test("passKindOf: Lift-Abo geht vor", () => {
  const tickets = [
    { subscriptionId: 1, status: "VALID", endDate: later },
    { subscriptionId: 2, status: "VALID", endDate: later },
  ];
  assert.equal(passKindOf(tickets, cfg, now), "RIDE");
});

test("passKindOf: abgelaufenes Ride Abo zählt nicht, solange ein Beach Abo läuft", () => {
  const tickets = [
    { subscriptionId: 2, status: "VALID", endDate: past },
    { subscriptionId: 1, status: "VALID", endDate: later },
  ];
  assert.equal(passKindOf(tickets, cfg, now), "BEACH");
});

test("passKindOf: ohne gültiges Ticket zählen alle Tickets", () => {
  assert.equal(passKindOf([{ subscriptionId: 1, status: "VALID", endDate: past }], cfg, now), "BEACH");
  assert.equal(passKindOf([{ subscriptionId: 1, status: "INVALID", endDate: later }], cfg, now), "BEACH");
});

test("passKindOf: aus, Tagesgäste und leere Liste bleiben beim Ride Pass", () => {
  assert.equal(passKindOf([{ subscriptionId: 1, status: "VALID", endDate: later }], { ...cfg, beachEnabled: false }, now), "RIDE");
  assert.equal(passKindOf([{ subscriptionId: null, status: "VALID", endDate: later }], cfg, now), "RIDE");
  assert.equal(passKindOf([], cfg, now), "RIDE");
});

test("beachOnlySubscriptionIds: Lift-Abo nie im Beach Pass, aus = leer", () => {
  assert.deepEqual(beachOnlySubscriptionIds({ ...cfg, beachSubscriptionIds: [1, 2] }), [1]);
  assert.deepEqual(beachOnlySubscriptionIds({ ...cfg, beachEnabled: false }), []);
  assert.equal(isBeachSubscription(cfg, 1), true);
  assert.equal(isBeachSubscription(cfg, 2), false);
  assert.equal(isBeachSubscription(cfg, null), false);
});

test("Zielgruppe: beide Pässe sehen ALL, alte Einträge ohne Wert gelten für Ride", () => {
  assert.deepEqual(audiencesFor("BEACH"), ["BEACH", "ALL"]);
  assert.equal(audienceMatches("ALL", "BEACH"), true);
  assert.equal(audienceMatches("RIDE", "BEACH"), false);
  assert.equal(audienceMatches(null, "RIDE"), true);
  assert.equal(audienceMatches("BEACH", "RIDE"), false);
  assert.equal(parseAudience("BEACH"), "BEACH");
  assert.equal(parseAudience("x"), null);
});
