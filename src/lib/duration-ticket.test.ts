import { test } from "node:test";
import assert from "node:assert/strict";
import { isDurationPastBerlinDay } from "./duration-ticket";

const dayTicket = {
  validityType: "DURATION" as const,
  validityDurationMinutes: 1440,
  startDate: new Date("2026-08-22T22:00:00.000Z"), // 23.08. 00:00 Berlin
  firstScanAt: new Date("2026-08-23T11:41:28.000Z"),
};

test("Tageskarte gilt am Ticket-Tag inkl. spaetem Abend", () => {
  assert.equal(isDurationPastBerlinDay(dayTicket, new Date("2026-08-23T21:50:00.000Z")), false);
});

test("Tageskarte gilt nicht am Folgetag", () => {
  assert.equal(isDurationPastBerlinDay(dayTicket, new Date("2026-08-23T22:00:00.000Z")), true); // 24.08. 00:00 Berlin
  assert.equal(isDurationPastBerlinDay(dayTicket, new Date("2026-08-24T10:00:00.000Z")), true);
});

test("1h-Ticket: Strandbad-Folgetag zu, selber Tag ok", () => {
  const hour = {
    validityType: "DURATION",
    validityDurationMinutes: 60,
    startDate: new Date("2026-08-22T22:00:00.000Z"),
    firstScanAt: new Date("2026-08-23T08:00:00.000Z"),
  };
  assert.equal(isDurationPastBerlinDay(hour, new Date("2026-08-23T18:00:00.000Z")), false);
  assert.equal(isDurationPastBerlinDay(hour, new Date("2026-08-24T08:00:00.000Z")), true);
});

test("ohne startDate zaehlt firstScanAt", () => {
  const t = {
    validityType: "DURATION",
    validityDurationMinutes: 120,
    startDate: null,
    firstScanAt: new Date("2026-07-06T15:51:08.000Z"),
  };
  assert.equal(isDurationPastBerlinDay(t, new Date("2026-07-06T20:00:00.000Z")), false);
  assert.equal(isDurationPastBerlinDay(t, new Date("2026-07-07T10:00:00.000Z")), true);
});
