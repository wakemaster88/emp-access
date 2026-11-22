import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanFacilities,
  clashDatesLabel,
  describeClashGroup,
  facilityClashes,
  facilityKey,
  groupClashes,
  type FacilityProfile,
} from "./facility-overlap";
import type { PeriodSpec, ScheduleSpec } from "./operating-hours";

function days(weekdays: number[], opensAt: string, closesAt: string): PeriodSpec[] {
  return weekdays.map((weekday) => ({ weekday, opensAt, closesAt }));
}

function spec(name: string, periods: PeriodSpec[], exceptions: ScheduleSpec["exceptions"] = []): ScheduleSpec {
  return {
    name,
    seasons: [{ name: "Mai", startMmDd: "05-01", endMmDd: "05-31", sortOrder: 0, periods }],
    exceptions,
  };
}

// Mai 2027: 01.05. Sa, 06.05. Do (Himmelfahrt), 10.05. Mo.
const publicA: FacilityProfile = {
  id: 5,
  name: "Wasserski",
  facilities: ["Seilbahn A"],
  spec: spec(
    "Wasserski",
    [...days([1, 2, 3, 4], "16:00", "20:00"), ...days([5, 6], "12:00", "20:00")],
    [{ date: "2027-05-06", closed: false, opensAt: "12:00", closesAt: "20:00", note: "Christi Himmelfahrt" }],
  ),
};

const rentalA: FacilityProfile = {
  id: 10,
  name: "Bahnmiete A",
  facilities: ["seilbahn  a "],
  spec: spec("Bahnmiete A", [...days([1, 2, 3, 4], "10:00", "16:00"), ...days([5, 6], "10:00", "12:00")]),
};

test("facilityKey und cleanFacilities: Schreibweise egal, Doppelte weg", () => {
  assert.equal(facilityKey(" Seilbahn  A "), "seilbahn a");
  assert.deepEqual(cleanFacilities(["Seilbahn A", "seilbahn a", " ", "Übungslift "]), ["Seilbahn A", "Übungslift"]);
});

test("facilityClashes: berührende Spannen sind keine Überschneidung", () => {
  // Ohne Feiertag: Di–Fr 10–16 | 16–20, Sa/So 10–12 | 12–20.
  const plain = { ...publicA, spec: { ...publicA.spec, exceptions: [] } };
  assert.deepEqual(facilityClashes([plain, rentalA], "2027-05-01", 31), []);
});

test("facilityClashes: Feiertag mit Wochenendzeiten überschneidet die Bahnmiete", () => {
  const clashes = facilityClashes([publicA, rentalA], "2027-05-01", 31);
  assert.equal(clashes.length, 1);
  assert.deepEqual(clashes[0], {
    facility: "Seilbahn A",
    date: "2027-05-06",
    first: { id: 5, name: "Wasserski" },
    second: { id: 10, name: "Bahnmiete A" },
    start: 12 * 60,
    end: 16 * 60,
  });
});

test("facilityClashes: andere Anlage, keine Prüfung", () => {
  const rentalB = { ...rentalA, id: 11, name: "Bahnmiete B", facilities: ["Seilbahn B"] };
  assert.deepEqual(facilityClashes([publicA, rentalB], "2027-05-01", 31), []);
});

test("facilityClashes: Kurs auf zwei Anlagen trifft beide Bahnmieten", () => {
  const course: FacilityProfile = {
    id: 12,
    name: "Anfängerkurse",
    facilities: ["Seilbahn B", "Übungslift"],
    spec: spec("Anfängerkurse", days([5, 6], "12:00", "18:00")),
  };
  const rentalB: FacilityProfile = {
    id: 11,
    name: "Bahnmiete B",
    facilities: ["Seilbahn B"],
    spec: spec("Bahnmiete B", days([5, 6], "10:00", "13:00")),
  };
  const rentalL: FacilityProfile = {
    id: 13,
    name: "Bahnmiete ÜL",
    facilities: ["Übungslift"],
    spec: spec("Bahnmiete ÜL", days([5, 6], "17:00", "20:00")),
  };
  const groups = groupClashes(facilityClashes([course, rentalB, rentalL], "2027-05-01", 31));
  assert.equal(groups.length, 2);
  const b = groups.find((g) => g.facility === "Seilbahn B");
  const l = groups.find((g) => g.facility === "Übungslift");
  assert.ok(b && l);
  // Mai 2027: 5 Samstage und 5 Sonntage.
  assert.equal(b.dates.length, 10);
  assert.deepEqual([b.start, b.end], [12 * 60, 13 * 60]);
  assert.deepEqual([l.start, l.end], [17 * 60, 18 * 60]);
  // Paar in fester Reihenfolge (kleinere ID zuerst).
  assert.equal(b.first.name, "Bahnmiete B");
  assert.equal(
    describeClashGroup(b),
    "Seilbahn B: Bahnmiete B und Anfängerkurse 12–13 Uhr am 01.05., 02.05., 08.05., 09.05. und 6 weitere Tage",
  );
});

test("facilityClashes: Spanne über Mitternacht zählt am Folgetag", () => {
  const night: FacilityProfile = {
    id: 20,
    name: "Nachtfahrt",
    facilities: ["Seilbahn A"],
    spec: spec("Nachtfahrt", days([5], "22:00", "02:00")),
  };
  const early: FacilityProfile = {
    id: 21,
    name: "Frühfahrt",
    facilities: ["Seilbahn A"],
    spec: spec("Frühfahrt", days([6], "01:00", "03:00")),
  };
  const clashes = facilityClashes([night, early], "2027-05-01", 31);
  assert.ok(clashes.length > 0);
  assert.ok(clashes.every((c) => c.start === 60 && c.end === 120));
});

test("clashDatesLabel: kurz, mit Rest", () => {
  assert.equal(clashDatesLabel(["2027-05-06"]), "06.05.");
  assert.equal(
    clashDatesLabel(["2027-05-06", "2027-05-17", "2027-05-27", "2027-06-03", "2027-06-04"]),
    "06.05., 17.05., 27.05., 03.06. und 1 weiterer Tag",
  );
});
