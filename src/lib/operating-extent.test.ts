import assert from "node:assert/strict";
import { test } from "node:test";
import { bookedWindowsByDay, extendSpec, isOperatingExtent } from "./operating-extent";
import { isOperatingAt, mergeWindows, openingForDay, type ScheduleSpec } from "./operating-hours";

const TZ = "Europe/Berlin";

/** Sommersaison mit gleichen Zeiten an den genannten Wochentagen (0 = Mo). */
function spec(name: string, weekdays: number[], opensAt: string, closesAt: string): ScheduleSpec {
  return {
    name,
    seasons: [
      {
        name: "Sommer",
        startMmDd: "04-01",
        endMmDd: "10-31",
        sortOrder: 0,
        periods: weekdays.map((weekday) => ({ weekday, opensAt, closesAt })),
      },
    ],
    exceptions: [],
  };
}

const wasserski = spec("Wasserski", [0, 1, 2, 3, 4, 5, 6], "12:00", "18:00");
const ferienkurs = spec("Ferienkurs", [0, 1, 2, 3, 4], "10:00", "12:00");
const bahnmiete = spec("Bahnmiete A", [0, 1, 2, 3, 4, 5, 6], "08:00", "10:00");

test("mergeWindows legt berührende und überlappende Spannen zusammen", () => {
  assert.deepEqual(
    mergeWindows([
      { opensAt: "12:00", closesAt: "18:00", overnight: false },
      { opensAt: "10:00", closesAt: "12:00", overnight: false },
      { opensAt: "17:00", closesAt: "20:00", overnight: false },
    ]),
    [{ opensAt: "10:00", closesAt: "20:00", overnight: false }],
  );
  assert.deepEqual(
    mergeWindows([
      { opensAt: "08:00", closesAt: "10:00", overnight: false },
      { opensAt: "12:00", closesAt: "00:00", overnight: true },
    ]),
    [
      { opensAt: "08:00", closesAt: "10:00", overnight: false },
      { opensAt: "12:00", closesAt: "00:00", overnight: true },
    ],
  );
});

test("Ferienkurs-Ticket über fünf Tage zählt nur zu den Kurszeiten", () => {
  // Mo 19.07.2027 09:00 bis Sa 24.07. 14:00 (Berlin, Sommerzeit).
  const bookings = [
    { resourceId: "179715", start: new Date("2027-07-19T07:00:00Z"), end: new Date("2027-07-24T12:00:00Z") },
  ];
  const booked = bookedWindowsByDay(
    [{ spec: ferienkurs, annyResourceId: "179715" }],
    bookings,
    "2027-07-18",
    "2027-07-25",
    TZ,
  );
  assert.deepEqual(Object.keys(booked).sort(), ["2027-07-19", "2027-07-20", "2027-07-21", "2027-07-22", "2027-07-23"]);
  assert.deepEqual(booked["2027-07-21"], [{ opensAt: "10:00", closesAt: "12:00", overnight: false }]);
});

test("Buchung auf anderer Ressource oder ohne Ressource zählt nicht", () => {
  const bookings = [{ resourceId: "999", start: new Date("2027-07-19T07:00:00Z"), end: new Date("2027-07-19T12:00:00Z") }];
  assert.deepEqual(bookedWindowsByDay([{ spec: ferienkurs, annyResourceId: "179715" }], bookings, "2027-07-19", "2027-07-19", TZ), {});
  assert.deepEqual(bookedWindowsByDay([{ spec: ferienkurs, annyResourceId: null }], bookings, "2027-07-19", "2027-07-19", TZ), {});
});

test("Gebuchte Termine verlängern die Betriebszeit nur für Automationen", () => {
  const subs = [{ spec: ferienkurs, annyResourceId: "179715" }];
  const booked = { "2027-07-19": [{ opensAt: "10:00", closesAt: "12:00", overnight: false }] };

  assert.equal(extendSpec(wasserski, "SELF", subs, booked), wasserski);
  const ext = extendSpec(wasserski, "BOOKED_SUBPROFILES", subs, booked);
  assert.deepEqual(openingForDay(ext, "2027-07-19").windows, [{ opensAt: "10:00", closesAt: "18:00", overnight: false }]);
  // Ohne Buchung am Dienstag: nur der öffentliche Betrieb.
  assert.deepEqual(openingForDay(ext, "2027-07-20").windows, [{ opensAt: "12:00", closesAt: "18:00", overnight: false }]);
  assert.equal(isOperatingAt(ext, new Date("2027-07-19T08:30:00Z"), TZ), true);
  assert.equal(isOperatingAt(wasserski, new Date("2027-07-19T08:30:00Z"), TZ), false);
});

test("Alle Zeiten der Unterprofile, auch ohne Buchung", () => {
  const ext = extendSpec(wasserski, "SUBPROFILES", [{ spec: bahnmiete, annyResourceId: "179480" }]);
  assert.deepEqual(openingForDay(ext, "2027-06-14").windows, [
    { opensAt: "08:00", closesAt: "10:00", overnight: false },
    { opensAt: "12:00", closesAt: "18:00", overnight: false },
  ]);
  // Außerhalb der Saison bleibt alles zu.
  assert.equal(openingForDay(ext, "2027-12-13").closed, true);
});

test("Tag nur durch Unterprofil offen bekommt dessen Bezeichnung", () => {
  const publicWeekend = spec("Wasserski", [5, 6], "12:00", "18:00");
  const ext = extendSpec(publicWeekend, "SUBPROFILES", [{ spec: bahnmiete, annyResourceId: "179480" }]);
  const day = openingForDay(ext, "2027-06-14");
  assert.equal(day.closed, false);
  assert.equal(day.label, "Bahnmieten und Kurse");
});

test("isOperatingExtent", () => {
  assert.equal(isOperatingExtent("BOOKED_SUBPROFILES"), true);
  assert.equal(isOperatingExtent("ALL"), false);
  assert.equal(isOperatingExtent(undefined), false);
});
