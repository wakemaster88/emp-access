import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAreaScanLock } from "./scan-lock";

const STRANDBAD = 8;
const now = new Date("2026-08-25T09:24:27.000Z"); // 11:24:27 Berlin

/**
 * Minimal-Fake: liefert den letzten Eintritts-Scan zurueck, wenn er im
 * abgefragten Zeitfenster liegt, und protokolliert die Query.
 */
function fakeDb(lastEntry: Date | null) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    scan: {
      async findFirst(args: { where: Record<string, unknown> }) {
        calls.push(args.where);
        if (!lastEntry) return null;
        const gte = (args.where.scanTime as { gte: Date } | undefined)?.gte;
        if (gte && lastEntry < gte) return null;
        return { scanTime: lastEntry };
      },
    },
  };
}

test("Eintritt 14 Sekunden nach dem letzten wird gesperrt", async () => {
  const db = fakeDb(new Date("2026-08-25T09:24:13.000Z"));
  const lock = await evaluateAreaScanLock(db, {
    accountId: 1, areaId: STRANDBAD, lockSeconds: 120, ticketId: 58534, now,
  });
  assert.ok(lock);
  assert.equal(lock.silent, false);
  assert.equal(lock.message, "Dieses Ticket erst in 2 Minuten wieder scannen");
});

test("Eintritt nach Ablauf der Sperre ist frei", async () => {
  const db = fakeDb(new Date("2026-08-25T09:22:10.000Z")); // 137 s davor
  assert.equal(
    await evaluateAreaScanLock(db, {
      accountId: 1, areaId: STRANDBAD, lockSeconds: 120, ticketId: 58534, now,
    }),
    null,
  );
});

test("ohne konfigurierte Sperre wird nicht einmal abgefragt", async () => {
  const db = fakeDb(new Date("2026-08-25T09:24:13.000Z"));
  for (const lockSeconds of [null, undefined, 0]) {
    assert.equal(
      await evaluateAreaScanLock(db, {
        accountId: 1, areaId: STRANDBAD, lockSeconds, ticketId: 58534, now,
      }),
      null,
    );
  }
  assert.equal(db.calls.length, 0);
});

test("ohne Bereich (Geraet ohne accessIn) greift die Sperre nicht", async () => {
  const db = fakeDb(new Date("2026-08-25T09:24:13.000Z"));
  assert.equal(
    await evaluateAreaScanLock(db, {
      accountId: 1, areaId: null, lockSeconds: 120, ticketId: 58534, now,
    }),
    null,
  );
  assert.equal(db.calls.length, 0);
});

test("gezaehlt werden nur Eintritts-Leser des Bereichs und nur gewaehrte Scans", async () => {
  const db = fakeDb(new Date("2026-08-25T09:24:13.000Z"));
  await evaluateAreaScanLock(db, {
    accountId: 1, areaId: STRANDBAD, lockSeconds: 120, ticketId: 58534, now,
  });
  assert.deepEqual(db.calls[0].device, { accessIn: STRANDBAD });
  assert.equal(db.calls[0].result, "GRANTED");
  assert.equal(db.calls[0].ticketId, 58534);
});
