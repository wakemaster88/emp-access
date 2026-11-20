import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePredecessor, isRunningTicket, type PredecessorCandidate } from "./ticket-predecessor";

const NOW = new Date("2026-11-20T12:00:00Z");
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function T(id: number, p: Partial<PredecessorCandidate>): PredecessorCandidate {
  return {
    id,
    rfidCode: null,
    profileImage: null,
    updatedAt: d("2026-01-01"),
    subscriptionId: null,
    status: "VALID",
    startDate: null,
    endDate: null,
    ...p,
  };
}

const RIDE = 1, KIDS = 2;

test("isRunningTicket: gültig, pausiert oder eingelöst und nicht abgelaufen", () => {
  assert.equal(isRunningTicket({ status: "VALID", endDate: null }, NOW), true);
  assert.equal(isRunningTicket({ status: "PAUSED", endDate: d("2027-01-01") }, NOW), true);
  assert.equal(isRunningTicket({ status: "VALID", endDate: d("2026-11-01") }, NOW), false);
  assert.equal(isRunningTicket({ status: "INVALID", endDate: null }, NOW), false);
});

test("choosePredecessor: Verlängerung erbt Karte und Foto des alten Abos", () => {
  const old = T(1, { subscriptionId: RIDE, rfidCode: "C1", profileImage: "p1", status: "INVALID", startDate: d("2025-05-01"), endDate: d("2026-04-30") });
  const res = choosePredecessor([old], RIDE, NOW);
  assert.equal(res.kind, "match");
  assert.equal(res.kind === "match" && res.ticket.id, 1);
});

test("choosePredecessor: Kids-Abo erbt nicht die Karte des laufenden Ride-Abos (Familienkonto)", () => {
  const parent = T(1, { subscriptionId: RIDE, rfidCode: "C1", profileImage: "p1", startDate: d("2026-04-01"), endDate: d("2027-03-31") });
  assert.deepEqual(choosePredecessor([parent], KIDS, NOW), { kind: "ambiguous", reason: "family" });
});

test("choosePredecessor: im Familienkonto erbt das Kind die Karte seines eigenen alten Kids-Abos", () => {
  const parent = T(1, { subscriptionId: RIDE, rfidCode: "C1", startDate: d("2026-04-01"), endDate: d("2027-03-31") });
  const kidOld = T(2, { subscriptionId: KIDS, rfidCode: "K1", status: "INVALID", startDate: d("2025-06-01"), endDate: d("2026-05-31") });
  const res = choosePredecessor([parent, kidOld], KIDS, NOW);
  assert.equal(res.kind === "match" && res.ticket.id, 2);
});

test("choosePredecessor: zwei Karten zur selben Zeit sind zwei Personen", () => {
  const a = T(1, { subscriptionId: RIDE, rfidCode: "C1", status: "INVALID", startDate: d("2025-05-01"), endDate: d("2026-04-30") });
  const b = T(2, { subscriptionId: RIDE, rfidCode: "C2", status: "INVALID", startDate: d("2025-06-01"), endDate: d("2026-05-31") });
  assert.deepEqual(choosePredecessor([a, b], RIDE, NOW), { kind: "ambiguous", reason: "cards" });
});

test("choosePredecessor: Ersatzkarte nach der alten Karte, die neueste gilt", () => {
  const a = T(1, { subscriptionId: RIDE, rfidCode: "C1", status: "INVALID", startDate: d("2024-05-01"), endDate: d("2025-04-30"), updatedAt: d("2025-04-30") });
  const b = T(2, { subscriptionId: RIDE, rfidCode: "C2", status: "INVALID", startDate: d("2025-05-01"), endDate: d("2026-04-30"), updatedAt: d("2026-04-30") });
  const res = choosePredecessor([a, b], RIDE, NOW);
  assert.equal(res.kind === "match" && res.ticket.id, 2);
});

test("choosePredecessor: ohne Karte und Foto kein Vorgänger, der Namensweg darf ran", () => {
  const bare = T(1, { subscriptionId: RIDE, status: "INVALID" });
  assert.deepEqual(choosePredecessor([bare], RIDE, NOW), { kind: "none" });
  assert.deepEqual(choosePredecessor([], RIDE, NOW), { kind: "none" });
});

test("choosePredecessor: ohne Abo-Art (Kasse ohne Abo) wie bisher das neueste Ticket mit Karte", () => {
  const withCard = T(1, { rfidCode: "C1", updatedAt: d("2026-01-01"), startDate: d("2026-01-01"), endDate: d("2026-01-02") });
  const photoOnly = T(2, { profileImage: "p", updatedAt: d("2026-06-01") });
  const res = choosePredecessor([withCard, photoOnly], null, NOW);
  assert.equal(res.kind === "match" && res.ticket.id, 1);
});
