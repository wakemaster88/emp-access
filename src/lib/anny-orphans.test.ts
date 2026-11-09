import { test } from "node:test";
import assert from "node:assert/strict";
import { newAnnyIncomplete, orphanCleanupScope } from "./anny-orphans";

const cutoff = new Date("2026-01-01T00:00:00Z");

test("vollstaendiger Abruf: Buchungen im Fenster und Abos werden aufgeraeumt", () => {
  assert.deepEqual(orphanCleanupScope(newAnnyIncomplete(), cutoff), {
    OR: [{ startDate: { gte: cutoff } }, { uuid: { startsWith: "anny-sub:" } }],
  });
});

test("Buchungsseite fehlt: nur Abo-Tickets werden aufgeraeumt", () => {
  const incomplete = { bookings: ["bookings Seite 3 nicht lesbar"], subscriptions: [] };
  assert.deepEqual(orphanCleanupScope(incomplete, cutoff), { uuid: { startsWith: "anny-sub:" } });
});

test("plan-subscriptions fehlen: Abo-Tickets bleiben unangetastet", () => {
  const incomplete = { bookings: [], subscriptions: ["plan-subscriptions Seite 1: HTTP 429"] };
  assert.deepEqual(orphanCleanupScope(incomplete, cutoff), {
    startDate: { gte: cutoff },
    NOT: { uuid: { startsWith: "anny-sub:" } },
  });
});

test("beide Quellen unvollstaendig: kein Aufraeumen", () => {
  const incomplete = { bookings: ["x"], subscriptions: ["y"] };
  assert.equal(orphanCleanupScope(incomplete, cutoff), null);
});
