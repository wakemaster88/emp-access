import { test } from "node:test";
import assert from "node:assert/strict";
import { startScanSql } from "./gamification-sql";
import { startScanWhere } from "./gamification";

test("startScanSql: kein Start-Gerät ergibt null", () => {
  assert.equal(startScanSql(null), null);
  assert.equal(startScanSql(startScanWhere([])), null);
});

test("startScanSql: Start-Geräte als IN-Liste", () => {
  const sql = startScanSql(
    startScanWhere([
      { id: 3, countsAsStart: true, legacyStartsUntil: null },
      { id: 7, countsAsStart: true, legacyStartsUntil: null },
    ]),
  )!;
  assert.equal(sql.sql, `(s."deviceId" IN (?,?))`);
  assert.deepEqual(sql.values, [3, 7]);
});

test("startScanSql: Altgerät nur mit Scans vor dem Stichtag", () => {
  const until = new Date("2026-07-15T10:00:00.000Z");
  const sql = startScanSql(
    startScanWhere([
      { id: 3, countsAsStart: true, legacyStartsUntil: null },
      { id: 9, countsAsStart: false, legacyStartsUntil: until },
      { id: 4, countsAsStart: false, legacyStartsUntil: null },
    ]),
  )!;
  assert.equal(sql.sql, `(s."deviceId" IN (?)) OR (s."deviceId" = ? AND s."scanTime" < ?)`);
  assert.deepEqual(sql.values, [3, 9, until]);
});
