import { test } from "node:test";
import assert from "node:assert/strict";
import { vereinAreaIds, type VereinAccessTicket } from "./verein-access";

const SEILBAHN_A = 5;
const STRANDBAD = 8;
const INSEL = 16;

// Mitlaeufer-Termin Do 17.09.2026, 17–19 Uhr Berlin (MESZ)
const mitlaeufer: VereinAccessTicket = {
  status: "VALID",
  startDate: new Date("2026-09-17T15:00:00.000Z"),
  endDate: new Date("2026-09-17T17:00:00.000Z"),
  validityType: "TIME_SLOT",
  slotStart: "17:00",
  slotEnd: "19:00",
  validityDurationMinutes: null,
  firstScanAt: null,
  accessAreaId: SEILBAHN_A,
  ticketAreas: [{ accessAreaId: STRANDBAD }, { accessAreaId: INSEL }],
};

const berlin = (hhmm: string, day = "2026-09-17") => new Date(`${day}T${hhmm}:00+02:00`);
const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

test("Seilbahn A nur im Zeitfenster, minutengenau", () => {
  assert.equal(vereinAreaIds([mitlaeufer], berlin("16:59")).includes(SEILBAHN_A), false);
  assert.equal(vereinAreaIds([mitlaeufer], berlin("17:00")).includes(SEILBAHN_A), true);
  assert.equal(vereinAreaIds([mitlaeufer], berlin("19:00")).includes(SEILBAHN_A), true);
  assert.equal(vereinAreaIds([mitlaeufer], berlin("19:01")).includes(SEILBAHN_A), false);
});

test("Strandbad und Insel sind am Termin-Tag auch vor dem Fenster offen", () => {
  assert.deepEqual(sorted(vereinAreaIds([mitlaeufer], berlin("16:30"))), [STRANDBAD, INSEL]);
});

test("Ausgang ignoriert das Zeitfenster", () => {
  assert.equal(vereinAreaIds([mitlaeufer], berlin("19:30"), { isExit: true }).includes(SEILBAHN_A), true);
});

test("an anderen Tagen und bei ungueltigem Status gibt es nichts", () => {
  assert.deepEqual(vereinAreaIds([mitlaeufer], berlin("17:30", "2026-09-16")), []);
  assert.deepEqual(vereinAreaIds([mitlaeufer], berlin("17:30", "2026-09-18")), []);
  assert.deepEqual(vereinAreaIds([{ ...mitlaeufer, status: "INVALID" }], berlin("17:30")), []);
});

test("Hauptbereich in ticketAreas umgeht das Fenster nicht", () => {
  const t = { ...mitlaeufer, ticketAreas: [{ accessAreaId: SEILBAHN_A }, { accessAreaId: STRANDBAD }] };
  assert.deepEqual(vereinAreaIds([t], berlin("16:00")), [STRANDBAD]);
});

test("ohne Hauptbereich gilt das Fenster fuer alle Bereiche", () => {
  const t = { ...mitlaeufer, accessAreaId: null };
  assert.deepEqual(vereinAreaIds([t], berlin("16:00")), []);
  assert.deepEqual(sorted(vereinAreaIds([t], berlin("18:00"))), [STRANDBAD, INSEL]);
});

test("Jahres-Zutrittsticket gilt ganztags", () => {
  const jahr: VereinAccessTicket = {
    status: "VALID",
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-12-31T23:59:59.999Z"),
    validityType: "DATE_RANGE",
    slotStart: null,
    slotEnd: null,
    validityDurationMinutes: null,
    firstScanAt: null,
    accessAreaId: STRANDBAD,
    ticketAreas: [],
  };
  assert.deepEqual(vereinAreaIds([jahr], berlin("07:00")), [STRANDBAD]);
});
