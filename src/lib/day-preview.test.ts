import { test } from "node:test";
import assert from "node:assert/strict";
import { berlinDayRange, summarizeBookings, type PreviewTicket } from "./day-preview";

let nextId = 1;
function t(over: Partial<PreviewTicket>): PreviewTicket {
  return {
    id: nextId++,
    uuid: null,
    name: "Gast",
    firstName: null,
    lastName: null,
    serviceId: 1,
    serviceName: "Tageskarte",
    ticketTypeName: null,
    validityType: "DATE_RANGE",
    slotStart: null,
    slotEnd: null,
    startDate: new Date("2026-07-10T08:00:00Z"),
    endDate: new Date("2026-07-10T18:00:00Z"),
    annyResourceId: null,
    annyOrderId: null,
    addOns: null,
    ...over,
  };
}

test("berlinDayRange: Winter- und Sommerzeit", () => {
  assert.equal(berlinDayRange("2026-11-05").start.toISOString(), "2026-11-04T23:00:00.000Z");
  assert.equal(berlinDayRange("2026-11-05").end.toISOString(), "2026-11-05T23:00:00.000Z");
  assert.equal(berlinDayRange("2026-07-10").start.toISOString(), "2026-07-09T22:00:00.000Z");
  // Umstellungstag Ende Oktober hat 25 Stunden
  const r = berlinDayRange("2026-10-25");
  assert.equal(r.start.toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-10-25T23:00:00.000Z");
});

test("Kombi-Tickets zaehlen als ein Gast", () => {
  const s = summarizeBookings([
    t({ uuid: "anny:c1:5:100", serviceId: 5, serviceName: "Aquapark Tageskarte", annyResourceId: "A" }),
    t({ uuid: "anny:c1:5:101", serviceId: 5, serviceName: "Aquapark Tageskarte", annyResourceId: "B" }),
    t({ uuid: "anny:c2:1:200" }),
  ]);
  assert.equal(s.guests, 2);
  assert.deepEqual(s.byService, [
    { label: "Aquapark Tageskarte", guests: 1 },
    { label: "Tageskarte", guests: 1 },
  ]);
  assert.equal(s.slottedGuests, 0);
});

test("Termine, Stosszeit und Gruppe", () => {
  const kurs = (o: Partial<PreviewTicket>) =>
    t({ serviceName: "Anfängerkurs", slotStart: "14:00", slotEnd: "16:00", serviceId: 2, ...o });
  const tickets = [
    ...Array.from({ length: 6 }, (_, i) =>
      kurs({ uuid: `anny:c9:2:${300 + i}`, annyOrderId: "O1", lastName: i === 0 ? "Müller" : "Kind" }),
    ),
    t({ serviceName: "Bahnmiete", slotStart: "10:00", slotEnd: "11:00", uuid: "anny:c3:3:400", serviceId: 3 }),
    t({ serviceName: "Bahnmiete", slotStart: "15:00", slotEnd: "16:00", uuid: "anny:c4:3:401", serviceId: 3 }),
  ];
  const s = summarizeBookings(tickets);
  assert.equal(s.guests, 8);
  assert.equal(s.slottedGuests, 8);
  assert.deepEqual(s.slots[0], { time: "10:00", end: "11:00", label: "Bahnmiete", guests: 1 });
  assert.deepEqual(s.peaks[0], { from: "14:00", to: "16:00", guests: 7 });
  assert.deepEqual(s.groups, [{ name: "Müller", guests: 6, label: "Anfängerkurs", time: "14:00" }]);
});

test("Verleihmaterial je Auftrag einmal, Flex-Option kein Material", () => {
  const addOns = [{ name: "Neoprenanzug", quantity: 2 }, { name: "Flex-Option", quantity: 1 }];
  const s = summarizeBookings([
    t({ annyOrderId: "X", addOns }),
    t({ annyOrderId: "X", addOns }),
    t({ annyOrderId: "Y", addOns: [{ name: "Neoprenanzug", quantity: 1 }, { name: "Helm" }] }),
  ]);
  assert.deepEqual(s.rentals, [
    { name: "Neoprenanzug", quantity: 3 },
    { name: "Helm", quantity: 1 },
  ]);
});
