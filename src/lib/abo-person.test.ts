import { test } from "node:test";
import assert from "node:assert/strict";
import { canBeSamePerson, hasConcurrent, overlapDays, samePersonAbos, SUCCESSION_OVERLAP_DAYS } from "./abo-person";

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const P = (start: string | null, end: string | null) => ({ startDate: start ? d(start) : null, endDate: end ? d(end) : null });

test("overlapDays: Tage, in denen beide Abos laufen", () => {
  assert.equal(overlapDays(P("2026-01-01", "2026-12-31"), P("2027-01-01", "2027-12-31")), 0);
  assert.equal(overlapDays(P("2026-01-01", "2026-12-31"), P("2026-12-01", "2027-11-30")), 30);
  assert.equal(overlapDays(P("2026-01-01", "2026-12-31"), P("2026-03-01", "2026-03-11")), 10);
});

test("overlapDays: ohne Datum zählt die Laufzeit als offen", () => {
  assert.equal(overlapDays(P(null, null), P("2026-01-01", "2026-01-31")), 30);
  assert.equal(overlapDays(P("2026-01-01", null), P("2025-01-01", "2025-12-31")), 0);
  assert.equal(overlapDays(P(null, null), P(null, null)), Infinity);
});

test("canBeSamePerson: Verlängerung und früh gekauftes Folge-Abo sind dieselbe Person", () => {
  assert.equal(canBeSamePerson(P("2025-05-01", "2026-04-30"), P("2026-05-01", "2027-04-30")), true);
  assert.equal(canBeSamePerson(P("2025-05-01", "2026-04-30"), P("2026-04-01", "2027-03-31")), true);
  assert.equal(SUCCESSION_OVERLAP_DAYS, 31);
});

test("canBeSamePerson: gleichzeitig laufende Abos sind zwei Personen (Eltern und Kind)", () => {
  assert.equal(canBeSamePerson(P("2026-05-01", "2027-04-30"), P("2026-06-15", "2027-06-14")), false);
  assert.equal(canBeSamePerson(P(null, null), P("2026-06-15", "2027-06-14")), false);
});

test("samePersonAbos: nacheinander laufende Abos kommen alle mit (Kids, dann Ride)", () => {
  const kids = P("2024-05-01", "2025-04-30"), ride = P("2025-05-01", "2026-04-30"), now = P("2026-05-01", "2027-04-30");
  assert.equal(hasConcurrent([kids, ride, now]), false);
  assert.deepEqual(samePersonAbos([now], [kids, ride]), [kids, ride]);
});

test("samePersonAbos: Familienkonto mit gleichzeitigen Abos, nichts kommt automatisch mit", () => {
  const parentOld = P("2025-04-01", "2026-03-31"), parent = P("2026-04-01", "2027-03-31"), kid = P("2026-06-01", "2027-05-31");
  assert.equal(hasConcurrent([kid, parent, parentOld]), true);
  // Das alte Abo der Eltern läuft vor dem Kinder-Abo, gehört aber nicht dem Kind.
  assert.deepEqual(samePersonAbos([kid], [parent, parentOld]), []);
  assert.deepEqual(samePersonAbos([parent], [kid, parentOld]), []);
});
