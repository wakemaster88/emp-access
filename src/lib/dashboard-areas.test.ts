import { test } from "node:test";
import assert from "node:assert/strict";
import { areaMetric, hasWeekActivity, summarizeAreasDay, type AreaDayScan, type AreaDevice } from "./dashboard-areas";

const NOW = new Date("2026-08-25T15:00:00+02:00");

function device(partial: Partial<AreaDevice> & { id: number }): AreaDevice {
  return {
    name: `Leser ${partial.id}`,
    accessIn: null,
    accessOut: null,
    countsAsStart: false,
    lastUpdate: NOW,
    ...partial,
  };
}

function scan(partial: Partial<AreaDayScan> & { deviceId: number; at: string }): AreaDayScan {
  const { at, ...rest } = partial;
  return {
    result: "GRANTED",
    note: null,
    ticketId: 1,
    ticketTypeName: "Tageskarte",
    scanTime: new Date(`2026-08-25T${at}:00+02:00`),
    ...rest,
  };
}

// Strandbad (1): Eingang 10, Ausgang 11. Seilbahn (2): ein Startleser 20.
const AREAS = [
  { id: 1, name: "Strandbad", personLimit: 600 },
  { id: 2, name: "Seilbahn A", personLimit: null },
  { id: 3, name: "Insel", personLimit: null },
];
const DEVICES = [
  device({ id: 10, name: "Strandbad Eingang", accessIn: 1 }),
  device({ id: 11, name: "Strandbad Ausgang", accessOut: 1, lastUpdate: new Date(NOW.getTime() - 30 * 60_000) }),
  device({ id: 20, name: "Seilbahn A Start", accessIn: 2, countsAsStart: true }),
];

test("Bedeutung der Zahl je Bereich: Fahrten, Eintritte oder Durchgänge", () => {
  assert.equal(areaMetric(DEVICES, 2), "rides");
  assert.equal(areaMetric(DEVICES, 1), "entries");
  // Ein Leser zählt in beide Richtungen (Drehkreuz ohne getrennten Ausgang).
  assert.equal(areaMetric([device({ id: 30, accessIn: 4, accessOut: 4 })], 4), "passes");
});

test("zählt je Bereich getrennt und nur an Eingängen", () => {
  const dayScans = [
    scan({ deviceId: 10, at: "10:00", ticketId: 1 }),
    scan({ deviceId: 10, at: "10:30", ticketId: 2 }),
    scan({ deviceId: 11, at: "12:00", ticketId: 1 }), // Ausgang: kein Eintritt
    scan({ deviceId: 20, at: "11:00", ticketId: 5 }),
    scan({ deviceId: 20, at: "11:20", ticketId: 5 }),
    scan({ deviceId: 20, at: "11:40", ticketId: 5 }),
    scan({ deviceId: 20, at: "11:50", ticketId: null, result: "DENIED", note: "Ticket abgelaufen" }),
  ];
  const result = summarizeAreasDay({
    dateStr: "2026-08-25",
    now: NOW,
    areas: AREAS,
    devices: DEVICES,
    dayScans,
    weekScans: dayScans,
    sold: new Map([[1, 7]]),
  });

  // Insel hat keinen Leser und fehlt; Strandbad (2 Leser) vor Seilbahn (1 Leser).
  assert.deepEqual(
    result.map((a) => a.name),
    ["Strandbad", "Seilbahn A"],
  );

  const beach = result[0];
  assert.equal(beach.metric, "entries");
  assert.equal(beach.totals.rides, 2);
  assert.equal(beach.totals.guests, 2);
  assert.equal(beach.totals.soldTickets, 7);
  // Der Ausgang steht in der Leserliste (nach dem Eingang), zählt aber nicht mit.
  assert.deepEqual(
    beach.devices.map((d) => [d.name, d.direction, d.total, d.online]),
    [
      ["Strandbad Eingang", "IN", 2, true],
      ["Strandbad Ausgang", "OUT", 1, false],
    ],
  );

  const lift = result[1];
  assert.equal(lift.metric, "rides");
  assert.equal(lift.totals.rides, 3);
  assert.equal(lift.totals.guests, 1);
  assert.equal(lift.totals.denied, 1);
  assert.equal(lift.totals.ridesPerGuest, 3);
  assert.equal(lift.hourly.find((h) => h.hour === "11:00")?.granted, 3);
});

test("Bereich ohne Scan in der Woche gilt als ruhig", () => {
  const [beach] = summarizeAreasDay({
    dateStr: "2026-08-25",
    now: NOW,
    areas: AREAS,
    devices: DEVICES,
    dayScans: [],
    weekScans: [],
    sold: new Map(),
  });
  assert.equal(hasWeekActivity(beach), false);
  assert.equal(beach.week.length, 7);
});
