import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAreaScanLock, evaluateScanLock } from "./scan-lock";

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

/**
 * Fake fuer die Geraete-Sperre: haelt mehrere Scans, wendet den Filter wie
 * die Datenbank an (inkl. scanTime.gte) und liefert den juengsten Treffer.
 */
function fakeDeviceDb(scans: { scanTime: Date; code: string; ticketId: number | null }[]) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    scan: {
      async findFirst(args: { where: Record<string, unknown> }) {
        calls.push(args.where);
        const w = args.where;
        const gte = (w.scanTime as { gte: Date } | undefined)?.gte;
        const hits = scans
          .filter((s) => (w.ticketId !== undefined ? s.ticketId === w.ticketId : s.code === w.code))
          .filter((s) => !gte || s.scanTime >= gte)
          .sort((a, b) => b.scanTime.getTime() - a.scanTime.getTime());
        return hits[0] ? { scanTime: hits[0].scanTime, code: hits[0].code } : null;
      },
    },
  };
}

const ago = (ms: number) => new Date(Date.now() - ms);

test("Geraete-Sperre: fragt nur Scans im Sperrfenster ab", async () => {
  const db = fakeDeviceDb([]);
  const before = Date.now();
  await evaluateScanLock(db, { accountId: 1, deviceId: 3, lockSeconds: 60, code: "A", ticketId: 7 });
  const gte = (db.calls[0].scanTime as { gte: Date }).gte.getTime();
  assert.ok(gte >= before - 60_000 && gte <= Date.now() - 60_000);
  assert.equal(db.calls[0].ticketId, 7);
  assert.equal(db.calls[0].result, "GRANTED");
});

test("Geraete-Sperre: letzter Scan im Fenster sperrt, aeltere Historie spielt keine Rolle", async () => {
  const db = fakeDeviceDb([
    { scanTime: ago(400 * 86_400_000), code: "A", ticketId: 7 },
    { scanTime: ago(3_600_000), code: "A", ticketId: 7 },
    { scanTime: ago(20_000), code: "B", ticketId: 7 },
  ]);
  const lock = await evaluateScanLock(db, { accountId: 1, deviceId: 3, lockSeconds: 60, code: "A", ticketId: 7 });
  assert.ok(lock);
  assert.equal(lock.silent, false);
  assert.ok(lock.remainingMs > 35_000 && lock.remainingMs <= 40_000);
});

test("Geraete-Sperre: letzter Scan vor dem Fenster sperrt nicht", async () => {
  const db = fakeDeviceDb([
    { scanTime: ago(3_600_000), code: "A", ticketId: 7 },
    { scanTime: ago(61_000), code: "A", ticketId: 7 },
  ]);
  assert.equal(
    await evaluateScanLock(db, { accountId: 1, deviceId: 3, lockSeconds: 60, code: "A", ticketId: 7 }),
    null,
  );
});

test("Geraete-Sperre: ohne ticketId zaehlt derselbe Code, Prellen bleibt still", async () => {
  const db = fakeDeviceDb([{ scanTime: ago(1_000), code: "C", ticketId: null }]);
  const lock = await evaluateScanLock(db, { accountId: 1, deviceId: 3, lockSeconds: 10, code: "C" });
  assert.ok(lock);
  assert.equal(lock.silent, true);
  assert.equal(db.calls[0].code, "C");
});

test("Geraete-Sperre: Ausgang, ohne Geraet oder ohne Sperrzeit wird nicht abgefragt", async () => {
  const db = fakeDeviceDb([{ scanTime: ago(1_000), code: "C", ticketId: 7 }]);
  assert.equal(await evaluateScanLock(db, { accountId: 1, deviceId: 3, lockSeconds: 10, code: "C", isExit: true }), null);
  assert.equal(await evaluateScanLock(db, { accountId: 1, deviceId: null, lockSeconds: 10, code: "C" }), null);
  assert.equal(await evaluateScanLock(db, { accountId: 1, deviceId: 3, lockSeconds: 0, code: "C" }), null);
  assert.equal(db.calls.length, 0);
});
