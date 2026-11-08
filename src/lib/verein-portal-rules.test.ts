import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billingCsv,
  billingTotals,
  canVereinCancel,
  isDateBookable,
  monthBounds,
  parseEuroToCents,
  portalSlotStates,
} from "./verein-portal-rules";

const NOW = new Date("2026-11-08T10:00:00+01:00");

test("Buchungsfenster: heute bis heute + Vorlauf", () => {
  assert.equal(isDateBookable("2026-11-08", 30, NOW), true);
  assert.equal(isDateBookable("2026-11-07", 30, NOW), false);
  assert.equal(isDateBookable("2026-12-08", 30, NOW), true);
  assert.equal(isDateBookable("2026-12-09", 30, NOW), false);
});

test("Storno nur bis zur Frist vor Beginn", () => {
  assert.equal(canVereinCancel(new Date("2026-11-10T10:00:00+01:00"), 48, NOW), true);
  assert.equal(canVereinCancel(new Date("2026-11-10T09:59:00+01:00"), 48, NOW), false);
  assert.equal(canVereinCancel(new Date("2026-11-08T10:30:00+01:00"), 0, NOW), true);
});

test("Slot-Zustand: eigene Buchung vor belegt, Vergangenes zaehlt nicht als frei", () => {
  const states = portalSlotStates(
    [
      { startTime: "12:00", endTime: "13:00", startIso: "2026-11-08T12:00:00+01:00", available: true },
      { startTime: "09:00", endTime: "10:00", startIso: "2026-11-08T09:00:00+01:00", available: true },
      { startTime: "14:00", endTime: "15:00", startIso: "2026-11-08T14:00:00+01:00", available: false },
      { startTime: "16:00", endTime: "17:00", startIso: "2026-11-08T16:00:00+01:00", available: false },
      { startTime: "18:00", endTime: "19:00", startIso: "2026-11-08T18:00:00+01:00", available: true },
    ],
    { mine: new Set(["16:00"]), blocked: new Set(["18:00"]), now: NOW },
  );
  assert.deepEqual(
    states.map((s) => `${s.startTime}:${s.state}`),
    ["09:00:past", "12:00:free", "14:00:taken", "16:00:mine", "18:00:taken"],
  );
});

test("Euro-Eingabe", () => {
  assert.equal(parseEuroToCents("45"), 4500);
  assert.equal(parseEuroToCents("45,5"), 4550);
  assert.equal(parseEuroToCents("45.05 €"), 4505);
  assert.equal(parseEuroToCents(""), 0);
  assert.equal(parseEuroToCents("abc"), null);
  assert.equal(parseEuroToCents("-3"), null);
});

test("Monatsgrenzen", () => {
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthBounds("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(monthBounds("2026-13"), null);
});

test("Summen und CSV zaehlen nur gebuchte Slots", () => {
  const rows = [
    { id: 1, vereinName: "WSC; Nord", serviceName: "Bahnmiete A", date: "2026-11-12", slotStart: "18:00", slotEnd: "19:00", priceCents: 12000, status: "BOOKED" as const, bookedBy: "Jan", billedAt: null, invoiceRef: null },
    { id: 2, vereinName: "WSC; Nord", serviceName: "Bahnmiete A", date: "2026-11-13", slotStart: "18:00", slotEnd: "19:00", priceCents: 12000, status: "CANCELED" as const, bookedBy: "Jan", billedAt: null, invoiceRef: null },
    { id: 3, vereinName: "WSC; Nord", serviceName: "Bahnmiete B", date: "2026-11-14", slotStart: "10:00", slotEnd: "11:00", priceCents: 9950, status: "BOOKED" as const, bookedBy: null, billedAt: new Date("2026-11-30T12:00:00Z"), invoiceRef: "R-17" },
  ];
  assert.deepEqual(billingTotals(rows), { openCents: 12000, billedCents: 9950, openCount: 1, billedCount: 1 });
  const csv = billingCsv(rows).replace("﻿", "").trim().split("\r\n");
  assert.equal(csv.length, 3);
  assert.equal(csv[1], '"WSC; Nord";12.11.2026;18:00;19:00;Bahnmiete A;120,00;Jan;;');
  assert.equal(csv[2], '"WSC; Nord";14.11.2026;10:00;11:00;Bahnmiete B;99,50;;30.11.2026;R-17');
});

test("Zugangsfenster mit Vor- und Nachbereitung", async () => {
  const { accessWindow, isInAccessWindow, clampedBerlinHm } = await import("./verein-portal-rules");
  const b = { startDate: new Date("2026-11-10T20:00:00+01:00"), endDate: new Date("2026-11-10T21:00:00+01:00") };
  assert.equal(isInAccessWindow(b, 30, 45, new Date("2026-11-10T19:29:00+01:00")), false);
  assert.equal(isInAccessWindow(b, 30, 45, new Date("2026-11-10T19:30:00+01:00")), true);
  assert.equal(isInAccessWindow(b, 30, 45, new Date("2026-11-10T21:45:00+01:00")), true);
  assert.equal(isInAccessWindow(b, 30, 45, new Date("2026-11-10T21:46:00+01:00")), false);
  const w = accessWindow(b.startDate, b.endDate, 30, 45);
  assert.equal(clampedBerlinHm(w.from, "2026-11-10", "start"), "19:30");
  assert.equal(clampedBerlinHm(w.to, "2026-11-10", "end"), "21:45");
  const late = accessWindow(new Date("2026-11-10T23:00:00+01:00"), new Date("2026-11-10T23:45:00+01:00"), 0, 60);
  assert.equal(clampedBerlinHm(late.to, "2026-11-10", "end"), "23:59");
  const early = accessWindow(new Date("2026-11-10T00:15:00+01:00"), new Date("2026-11-10T01:00:00+01:00"), 30, 0);
  assert.equal(clampedBerlinHm(early.from, "2026-11-10", "start"), "00:00");
});
