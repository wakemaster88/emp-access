import { test } from "node:test";
import assert from "node:assert/strict";
import { aboStatus, berlinDaysUntil, daysLeftText } from "./rider-shop";

test("berlinDaysUntil zählt Kalendertage in Berlin", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  // Ende 23:59 Berlin am selben Tag
  assert.equal(berlinDaysUntil(new Date("2026-11-20T22:59:00Z"), now), 0);
  assert.equal(berlinDaysUntil(new Date("2026-11-21T22:59:00Z"), now), 1);
  // Mitternacht Berlin am 30.11. = 29.11. 23:00 UTC
  assert.equal(berlinDaysUntil(new Date("2026-11-29T23:00:00Z"), now), 10);
  // Spät abends Berlin zählt schon als nächster Tag
  assert.equal(berlinDaysUntil(new Date("2026-11-22T00:00:00Z"), new Date("2026-11-20T23:30:00Z")), 1);
});

test("aboStatus unterscheidet keins, abgelaufen, aktiv und ohne Ende", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  assert.deepEqual(aboStatus(null, now), { kind: "none" });
  assert.equal(aboStatus({ endDate: new Date("2026-11-01T00:00:00Z"), active: false }, now).kind, "expired");
  assert.deepEqual(aboStatus({ endDate: null, active: true }, now), { kind: "unlimited" });
  const s = aboStatus({ endDate: new Date("2027-11-20T22:59:00Z"), active: true }, now);
  assert.equal(s.kind, "active");
  assert.equal(s.kind === "active" && s.daysLeft, 365);
});

test("daysLeftText", () => {
  assert.equal(daysLeftText(0), "nur noch heute");
  assert.equal(daysLeftText(1), "noch 1 Tag");
  assert.equal(daysLeftText(42), "noch 42 Tage");
});
