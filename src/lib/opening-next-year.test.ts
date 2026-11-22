import assert from "node:assert/strict";
import { test } from "node:test";
import { describeNextYearGap, nextYearExceptionGap, type NextYearProfile } from "./opening-next-year";

const profiles: NextYearProfile[] = [
  { name: "Wasserski", parentId: null, exceptions: [{ date: "2027-03-29" }, { date: "2027-12-05" }] },
  { name: "Shop", parentId: null, exceptions: [{ date: "2027-05-17" }] },
  { name: "Grillplatz", parentId: null, exceptions: [] },
  { name: "Bahnmiete A", parentId: 5, exceptions: [{ date: "2027-05-06" }] },
  { name: "Bahnmiete B", parentId: 5, exceptions: [{ date: "2027-05-17" }] },
];

test("vor September keine Meldung", () => {
  assert.equal(nextYearExceptionGap(profiles, "2027-08-31"), null);
});

test("ab September: Profile mit Einträgen in diesem Jahr, aber keinem im nächsten", () => {
  const gap = nextYearExceptionGap(profiles, "2027-09-01");
  assert.deepEqual(gap, { year: 2028, areas: ["Wasserski", "Shop"], subCount: 2 });
  assert.equal(describeNextYearGap(gap!), "Wasserski, Shop und 2 Unterprofile");
});

test("schon eingetragen: keine Meldung", () => {
  const done = profiles.map((p) => ({ ...p, exceptions: [...p.exceptions, { date: "2028-04-17" }] }));
  assert.equal(nextYearExceptionGap(done, "2027-10-15"), null);
});

test("Stand November 2026 mit Einträgen für 2027", () => {
  const live: NextYearProfile[] = [
    { name: "Wasserski", parentId: null, exceptions: [{ date: "2026-12-06" }, { date: "2027-03-26" }] },
    { name: "Gastronomie", parentId: null, exceptions: [{ date: "2027-03-29" }] },
  ];
  assert.equal(nextYearExceptionGap(live, "2026-11-22"), null);
});

test("ein Bereich allein", () => {
  assert.equal(describeNextYearGap({ year: 2028, areas: ["Wasserski"], subCount: 0 }), "Wasserski");
  assert.equal(describeNextYearGap({ year: 2028, areas: [], subCount: 1 }), "1 Unterprofil");
});
