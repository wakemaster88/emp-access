import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageAt,
  chipHolder,
  decideCodeUse,
  deriveOwner,
  isTicketInUse,
  namesMatch,
  suggestByHour,
  suggestFromHistory,
  type CodeTicket,
} from "./chip-rules";
import { pickBestScanCandidate } from "./scan-candidate";

// Sonntag, 23.08.2026, 14:00 Uhr in Berlin.
const NOW = new Date("2026-08-23T12:00:00Z");
const YESTERDAY = new Date("2026-08-22T08:00:00Z");
const LAST_WEEK = new Date("2026-08-16T08:00:00Z");

let next = 1;
function T(p: Partial<CodeTicket> = {}): CodeTicket {
  return {
    id: next++,
    riderProfileId: null,
    subscriptionId: null,
    vereinId: null,
    bulkBatchId: null,
    source: null,
    status: "REDEEMED",
    startDate: LAST_WEEK,
    endDate: null,
    validityType: "DURATION",
    validityDurationMinutes: 120,
    firstScanAt: LAST_WEEK,
    barcode: "C1",
    createdAt: LAST_WEEK,
    firstName: null,
    lastName: null,
    ...p,
  };
}

const abo = (person: number | null, p: Partial<CodeTicket> = {}) =>
  T({
    subscriptionId: 3,
    riderProfileId: person,
    validityType: "DATE_RANGE",
    validityDurationMinutes: null,
    firstScanAt: null,
    status: "VALID",
    startDate: new Date("2026-05-12T00:00:00Z"),
    endDate: new Date("2027-05-12T00:00:00Z"),
    ...p,
  });

test("Eigentum: Mitarbeiter, Serie des Betriebs, sonst Gast", () => {
  assert.equal(deriveOwner([T({ source: "EMP_CONTROL" })]), "MITARBEITER");
  assert.equal(deriveOwner([T({ bulkBatchId: "b1", createdAt: LAST_WEEK }), T({ createdAt: YESTERDAY })]), "BETRIEB");
  assert.equal(deriveOwner([T({ createdAt: LAST_WEEK }), T({ bulkBatchId: "b1", createdAt: YESTERDAY })]), "KUNDE");
  assert.equal(deriveOwner([]), "KUNDE");
});

test("Leihbändchen gehört nur ausdrücklich einer Person", () => {
  const tickets = [T({ riderProfileId: 7 })];
  assert.deepEqual(chipHolder("BETRIEB", null, tickets), { personId: null, ambiguous: [] });
  assert.deepEqual(chipHolder("BETRIEB", { owner: "BETRIEB", riderProfileId: 9, blockedAt: null }, tickets), { personId: 9, ambiguous: [] });
  assert.deepEqual(chipHolder("KUNDE", null, tickets), { personId: 7, ambiguous: [] });
  assert.deepEqual(chipHolder("KUNDE", null, [T({ riderProfileId: 7 }), T({ riderProfileId: 8 })]), { personId: null, ambiguous: [7, 8] });
});

test("Neuer Code: frei", () => {
  assert.deepEqual(decideCodeUse({ code: "C1", chip: null, tickets: [], personId: null, now: NOW }), { kind: "FREE", personId: null });
  assert.deepEqual(decideCodeUse({ code: "C1", chip: null, tickets: [], personId: 5, now: NOW }), { kind: "FREE", personId: 5 });
});

test("Laufendes Abo behält das Bändchen: 2 Stunden für dieselbe Person teilen den Code", () => {
  const a = abo(5);
  const d = decideCodeUse({ code: "C1", chip: null, tickets: [a], personId: null, now: NOW });
  assert.deepEqual(d, { kind: "SHARE", personId: 5, setBarcode: false });
  const d2 = decideCodeUse({ code: "C1", chip: null, tickets: [a], personId: 5, now: NOW });
  assert.equal(d2.kind, "SHARE");
});

test("Barcode nur setzen, wenn kein altes Ticket ihn trägt", () => {
  const d = decideCodeUse({ code: "C1", chip: null, tickets: [T({ barcode: null })], personId: null, now: NOW });
  assert.deepEqual(d, { kind: "SHARE", personId: null, setBarcode: true });
});

test("Bändchen einer anderen Person: Konflikt, mit Bestätigung teilen oder übergeben", () => {
  const tickets = [abo(5)];
  const d = decideCodeUse({ code: "C1", chip: null, tickets, personId: 6, now: NOW });
  assert.equal(d.kind, "CONFLICT");
  assert.equal(d.kind === "CONFLICT" && d.reason, "OTHER_PERSON");
  assert.equal(decideCodeUse({ code: "C1", chip: null, tickets, personId: 6, resolve: "share", now: NOW }).kind, "SHARE");
  const t = decideCodeUse({ code: "C1", chip: null, tickets, personId: 6, resolve: "transfer", now: NOW });
  assert.deepEqual(t, { kind: "TRANSFER", personId: 6, stripTicketIds: [tickets[0].id] });
});

test("Eingetippter Name passt nicht zur Person am Bändchen: Konflikt", () => {
  const tickets = [abo(5)];
  const holder = { firstName: "Mia", lastName: "Lorenz" };
  const other = decideCodeUse({ code: "C1", chip: null, tickets, personId: null, typedName: { firstName: "Anna" }, chipPersonName: holder, now: NOW });
  assert.equal(other.kind === "CONFLICT" && other.reason, "OTHER_PERSON");
  const same = decideCodeUse({ code: "C1", chip: null, tickets, personId: null, typedName: { firstName: "mia" }, chipPersonName: holder, now: NOW });
  assert.deepEqual(same, { kind: "SHARE", personId: 5, setBarcode: false });
});

test("Stammgast ohne Konto: Bändchen ohne Person wird geteilt, mit Kunde gehört es ihm", () => {
  const tickets = [T(), T({ barcode: null })];
  assert.deepEqual(decideCodeUse({ code: "C1", chip: null, tickets, personId: null, now: NOW }), { kind: "SHARE", personId: null, setBarcode: false });
  assert.deepEqual(decideCodeUse({ code: "C1", chip: null, tickets, personId: 9, now: NOW }), { kind: "SHARE", personId: 9, setBarcode: false });
});

test("Leihbändchen: frei nach Ablauf, Konflikt solange ein Gast es heute nutzt", () => {
  const expired = T({ bulkBatchId: "b1", riderProfileId: 4 });
  assert.equal(decideCodeUse({ code: "C1", chip: null, tickets: [expired], personId: 6, now: NOW }).kind, "SHARE");
  const today = T({ bulkBatchId: null, startDate: new Date("2026-08-23T00:00:00Z"), firstScanAt: new Date("2026-08-23T11:30:00Z"), createdAt: new Date("2026-08-23T11:00:00Z") });
  const d = decideCodeUse({ code: "C1", chip: { owner: "BETRIEB", riderProfileId: null, blockedAt: null }, tickets: [expired, today], personId: null, now: NOW });
  assert.deepEqual(d, { kind: "CONFLICT", reason: "LEIH_IN_USE", ticketIds: [today.id], personId: null });
  const free = decideCodeUse({ code: "C1", chip: { owner: "BETRIEB", riderProfileId: null, blockedAt: null }, tickets: [expired, today], personId: null, resolve: "transfer", now: NOW });
  assert.equal(free.kind, "TRANSFER");
});

test("Mitarbeiter-Chip und gesperrtes Bändchen", () => {
  const staff = T({ source: "EMP_CONTROL" });
  assert.equal(decideCodeUse({ code: "C1", chip: null, tickets: [staff], personId: null, now: NOW }).kind, "CONFLICT");
  const blocked = decideCodeUse({ code: "C1", chip: { owner: "KUNDE", riderProfileId: null, blockedAt: YESTERDAY }, tickets: [], personId: null, resolve: "share", now: NOW });
  assert.equal(blocked.kind === "CONFLICT" && blocked.reason, "BLOCKED");
});

test("Mehrere Personen am Code: Konflikt, außer für eine davon", () => {
  const tickets = [T({ riderProfileId: 7 }), T({ riderProfileId: 8 })];
  const d = decideCodeUse({ code: "C1", chip: null, tickets, personId: null, now: NOW });
  assert.equal(d.kind === "CONFLICT" && d.reason, "AMBIGUOUS");
  assert.equal(decideCodeUse({ code: "C1", chip: null, tickets, personId: 8, now: NOW }).kind, "SHARE");
});

test("Heute nutzbar: Stundenkarte von gestern nicht, Abo ja", () => {
  assert.equal(isTicketInUse(abo(5), NOW), true);
  assert.equal(isTicketInUse(T({ firstScanAt: null, startDate: YESTERDAY, status: "VALID" }), NOW), false);
  assert.equal(isTicketInUse(T({ firstScanAt: null, startDate: new Date("2026-08-22T22:00:00Z"), status: "VALID" }), NOW), true);
  assert.equal(isTicketInUse(T({ status: "CANCELED", startDate: NOW, firstScanAt: null }), NOW), false);
});

test("Namen vergleichen: fehlender Teil passt, Akzente egal", () => {
  assert.equal(namesMatch({ firstName: "Zoë" }, { firstName: "Zoe", lastName: "X" }), true);
  assert.equal(namesMatch({ firstName: "Anna", lastName: "Lorenz" }, { firstName: "Mia", lastName: "Lorenz" }), false);
  assert.equal(namesMatch({}, { firstName: "Mia", lastName: null }), true);
});

test("Vorschlag aus der Historie: häufigster der letzten Käufe, Gleichstand zuletzt gekauft", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 7, n, 12));
  const history = [
    { serviceId: 1, subscriptionId: null, at: day(6) },
    { serviceId: 1, subscriptionId: null, at: day(5) },
    { serviceId: 2, subscriptionId: null, at: day(4) },
    { serviceId: 3, subscriptionId: null, at: day(3) },
    { serviceId: 2, subscriptionId: null, at: day(2) },
    { serviceId: null, subscriptionId: 9, at: day(7) },
    { serviceId: 99, subscriptionId: null, at: day(8) },
  ];
  const s = suggestFromHistory(history, new Set([1, 2, 3]));
  assert.equal(s.serviceId, 1);
  assert.equal(s.count, 2);
  assert.equal(s.of, 5);
  assert.deepEqual(s.frequent, [{ serviceId: 2, count: 2 }, { serviceId: 3, count: 1 }]);
  assert.equal(suggestFromHistory([], new Set([1])).basis, "none");
});

test("Vorschlag nach Uhrzeit: ± 1 Stunde, sonst ganzer Tag", () => {
  const sales = [
    { serviceId: 1, hour: 14, count: 5 },
    { serviceId: 2, hour: 13, count: 3 },
    { serviceId: 2, hour: 15, count: 3 },
    { serviceId: 3, hour: 9, count: 50 },
  ];
  const s = suggestByHour(sales, new Set([1, 2, 3]), NOW);
  assert.equal(s.serviceId, 2);
  assert.equal(s.basis, "hour");
  const night = suggestByHour(sales, new Set([1, 2, 3]), new Date("2026-08-23T01:00:00Z"));
  assert.equal(night.serviceId, 3);
});

test("Alter", () => {
  assert.equal(ageAt(new Date("2009-08-24T00:00:00Z"), NOW), 16);
  assert.equal(ageAt(new Date("2009-08-23T00:00:00Z"), NOW), 17);
  assert.equal(ageAt(null, NOW), null);
});

test("Gerät nimmt das Ticket für seinen Bereich: Abo und Stundenkarte am selben Bändchen", () => {
  const aboTicket = { id: 1, status: "VALID", startDate: new Date("2026-05-12T00:00:00Z"), endDate: new Date("2027-05-12T00:00:00Z"), validityType: "DATE_RANGE", validityDurationMinutes: null, firstScanAt: null, subscriptionId: 3, subscription: { areas: [{ id: 10 }] } };
  const hour = { id: 2, status: "VALID", startDate: new Date("2026-08-23T00:00:00Z"), endDate: null, validityType: "DURATION", validityDurationMinutes: 120, firstScanAt: null, subscriptionId: null, service: { serviceAreas: [{ accessAreaId: 20 }] } };
  assert.equal(pickBestScanCandidate([aboTicket, hour], NOW)?.id, 1);
  assert.equal(pickBestScanCandidate([aboTicket, hour], NOW, [20])?.id, 2);
  assert.equal(pickBestScanCandidate([aboTicket, hour], NOW, [10])?.id, 1);
});

test("Stundenkarte von gestern (nie gescannt) verliert gegen die neue von heute", () => {
  const old = { id: 1, status: "VALID", startDate: new Date("2026-08-22T00:00:00Z"), endDate: null, validityType: "DURATION", validityDurationMinutes: 120, firstScanAt: null };
  const fresh = { id: 2, status: "VALID", startDate: new Date("2026-08-22T22:00:00Z"), endDate: null, validityType: "DURATION", validityDurationMinutes: 120, firstScanAt: null };
  assert.equal(pickBestScanCandidate([old, fresh], NOW)?.id, 2);
});
