import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScheduleSpec } from "./operating-hours";
import { clipToProfileSpans, relatedResources, type RelatedProfileInput } from "./verein-related-bookings";

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

const week = [0, 1, 2, 3, 4, 5, 6];
const anfaengerUel = spec("Anfängerkurse Übungslift", week, "10:00", "12:00");
const anfaengerB = spec("Anfängerkurse Seilbahn B", week, "14:00", "16:00");
const ferienkurs = spec("Ferienkurs", [0, 1, 2, 3, 4], "10:00", "12:00");

// Stand der Profile im Konto (22.11.2026), Zeiten vereinfacht.
const profiles: RelatedProfileInput[] = [
  { annyResourceId: "179465", parentId: null, facilities: ["Seilbahn A"], spec: spec("Wasserski", week, "12:00", "18:00") },
  { annyResourceId: "179480", parentId: 5, facilities: ["Seilbahn A"], spec: spec("Bahnmiete A", week, "08:00", "10:00") },
  { annyResourceId: "182085", parentId: 5, facilities: ["Seilbahn B"], spec: spec("Bahnmiete B", week, "08:00", "10:00") },
  { annyResourceId: "182107", parentId: 5, facilities: ["Übungslift"], spec: spec("Bahnmiete Übungslift", week, "08:00", "20:00") },
  { annyResourceId: "179477", parentId: 5, facilities: ["Seilbahn B"], spec: anfaengerB },
  { annyResourceId: "179477", parentId: 5, facilities: ["übungslift "], spec: anfaengerUel },
  { annyResourceId: "179715", parentId: 5, facilities: ["Seilbahn A", "Seilbahn B", "Übungslift"], spec: ferienkurs },
];

test("Little Bro: Kurse am Übungslift zählen mit, Seilbahnen nicht", () => {
  const related = relatedResources(profiles, "182107");
  assert.deepEqual(
    related.map((r) => ({ id: r.resourceId, specs: r.specs.map((s) => s.name) })),
    [
      { id: "179477", specs: ["Anfängerkurse Übungslift"] },
      { id: "179715", specs: ["Ferienkurs"] },
    ],
  );
});

test("Ressource ohne Profil oder Anlage: keine Nachbarn", () => {
  assert.deepEqual(relatedResources(profiles, "123"), []);
  assert.deepEqual(
    relatedResources([{ annyResourceId: "1", parentId: 5, facilities: [], spec: ferienkurs }, ...profiles], "1"),
    [],
  );
});

test("Buchungen nur in den Zeiten des Unterprofils", () => {
  // Mo 14.06.2027, Buchung 9–13 Uhr Berlin; Kurs am Übungslift 10–12.
  const booking = { start: Date.parse("2027-06-14T07:00:00Z"), end: Date.parse("2027-06-14T11:00:00Z") };
  assert.deepEqual(clipToProfileSpans([booking], [anfaengerUel], "2027-06-14"), [
    { start: Date.parse("2027-06-14T08:00:00Z"), end: Date.parse("2027-06-14T10:00:00Z") },
  ]);
  // Ferienkurs-Ticket über die ganze Woche belegt am Mittwoch nur 10–12.
  const week5 = { start: Date.parse("2027-06-14T07:00:00Z"), end: Date.parse("2027-06-19T12:00:00Z") };
  assert.deepEqual(clipToProfileSpans([week5], [ferienkurs], "2027-06-16"), [
    { start: Date.parse("2027-06-16T08:00:00Z"), end: Date.parse("2027-06-16T10:00:00Z") },
  ]);
  assert.deepEqual(clipToProfileSpans([week5], [ferienkurs], "2027-06-19"), []);
});
