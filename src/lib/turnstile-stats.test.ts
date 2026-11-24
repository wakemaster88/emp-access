import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTurnstileDay, type TurnstileDayScan } from "./turnstile-stats";

function scan(
  partial: Partial<TurnstileDayScan> & { scanTime: Date; result: TurnstileDayScan["result"] },
): TurnstileDayScan {
  return {
    note: null,
    deviceId: 84,
    ticketId: 1,
    ticketTypeName: "Öffentlicher Betrieb - 1 Stunde",
    ...partial,
  };
}

test("zaehlt Fahrten, Gäste und Scans getrennt – nicht gültige Tickets", () => {
  const dayScans = [
    scan({ result: "GRANTED", ticketId: 1, scanTime: new Date("2026-08-25T08:00:00+02:00") }),
    scan({ result: "GRANTED", ticketId: 1, scanTime: new Date("2026-08-25T09:10:00+02:00") }),
    scan({
      result: "GRANTED",
      ticketId: 2,
      ticketTypeName: "Öffentlicher Betrieb - 2 Stunden",
      scanTime: new Date("2026-08-25T08:20:00+02:00"),
    }),
    scan({ result: "GRANTED", ticketId: null, ticketTypeName: null, scanTime: new Date("2026-08-25T12:00:00+02:00") }),
    scan({
      result: "DENIED",
      ticketId: null,
      note: "ticket_not_found",
      scanTime: new Date("2026-08-25T08:15:00+02:00"),
    }),
  ];

  const summary = summarizeTurnstileDay({
    dateStr: "2026-08-25",
    dayScans,
    weekScans: dayScans,
    soldTickets: 12,
    deviceIds: [84],
  });

  assert.equal(summary.totals.scans, 5);
  assert.equal(summary.totals.rides, 4);
  assert.equal(summary.totals.guests, 2);
  assert.equal(summary.totals.denied, 1);
  assert.equal(summary.totals.ridesWithoutTicket, 1);
  assert.equal(summary.totals.soldTickets, 12);
  assert.equal(summary.totals.grantRate, 80);
  assert.equal(summary.totals.ridesPerGuest, 1.5);
  assert.equal(summary.totals.peakHour?.hour, "08:00");
  assert.equal(summary.totals.peakHour?.count, 3);

  assert.equal(summary.hourly[8].granted, 2);
  assert.equal(summary.hourly[8].denied, 1);
  assert.equal(summary.hourly[9].granted, 1);
  assert.equal(summary.hourly[12].granted, 1);

  assert.deepEqual(
    summary.ticketTypes.map((t) => t.name),
    ["Öffentlicher Betrieb - 1 Stunde", "Öffentlicher Betrieb - 2 Stunden"],
  );
  assert.equal(summary.denyReasons[0]?.reason, "Ticket nicht gefunden");
  assert.equal(summary.deviceStats.get(84)?.granted, 4);

  const today = summary.weekTrend[6];
  assert.equal(today.date, "2026-08-25");
  assert.equal(today.rides, 4);
  assert.equal(today.guests, 2);
});

test("leerer Tag bleibt bei Null und ohne Vergleich", () => {
  const summary = summarizeTurnstileDay({
    dateStr: "2026-08-25",
    dayScans: [],
    weekScans: [],
    soldTickets: 0,
    deviceIds: [6, 84],
  });
  assert.equal(summary.totals.scans, 0);
  assert.equal(summary.totals.rides, 0);
  assert.equal(summary.totals.guests, 0);
  assert.equal(summary.totals.grantRate, 0);
  assert.equal(summary.totals.ridesPerGuest, 0);
  assert.equal(summary.totals.peakHour, null);
  assert.equal(summary.average, null);
  assert.equal(summary.deviceStats.get(6)?.total, 0);
});

test("weekCounts ergibt denselben Wochenverlauf wie weekScans", () => {
  const weekScans = [
    { result: "GRANTED", ticketId: 1, scanTime: new Date("2026-03-28T22:59:59Z") },
    { result: "GRANTED", ticketId: 1, scanTime: new Date("2026-03-28T23:00:00Z") },
    { result: "GRANTED", ticketId: 2, scanTime: new Date("2026-03-29T12:00:00Z") },
    { result: "GRANTED", ticketId: null, scanTime: new Date("2026-03-29T12:00:00Z") },
    { result: "DENIED", ticketId: 3, scanTime: new Date("2026-03-30T08:00:00Z") },
    { result: "PROTECTED", ticketId: 3, scanTime: new Date("2026-03-30T08:00:00Z") },
  ];
  const base = { dateStr: "2026-04-03", dayScans: [], soldTickets: 0 };
  const fromScans = summarizeTurnstileDay({ ...base, weekScans });
  const weekCounts = new Map([
    ["2026-03-28", { rides: 1, denied: 0, guests: 1 }],
    ["2026-03-29", { rides: 3, denied: 0, guests: 2 }],
    ["2026-03-30", { rides: 0, denied: 1, guests: 0 }],
    // ausserhalb der sieben Tage: wird nicht verwendet
    ["2026-03-01", { rides: 9, denied: 9, guests: 9 }],
  ]);
  const fromCounts = summarizeTurnstileDay({ ...base, weekScans: [], weekCounts });
  assert.deepEqual(fromCounts.weekTrend, fromScans.weekTrend);
  assert.deepEqual(fromCounts.average, fromScans.average);
  assert.deepEqual(fromCounts.previousDay, fromScans.previousDay);
});
