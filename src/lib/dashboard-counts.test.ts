import { test } from "node:test";
import assert from "node:assert/strict";
import { accountSql, deviceCountsByName } from "./dashboard-counts";

test("accountSql: mit Mandant als Parameter, ohne Mandant kein Filter", () => {
  const scoped = accountSql(7, `s."accountId"`);
  assert.equal(scoped.sql, `s."accountId" = ?`);
  assert.deepEqual(scoped.values, [7]);
  const all = accountSql(null);
  assert.equal(all.sql, "TRUE");
  assert.deepEqual(all.values, []);
});

test("deviceCountsByName: nach Name zusammengefasst, gleiche Summe nach erstem Scan", () => {
  const at = (iso: string) => new Date(iso);
  const names = new Map([
    [1, "Drehkreuz Nord"],
    [2, "Drehkreuz Sued"],
    [3, "Drehkreuz Nord"],
  ]);
  const rows = deviceCountsByName(
    [
      { deviceId: 2, result: "GRANTED", count: 3, firstAt: at("2026-06-01T09:00:00Z") },
      { deviceId: 1, result: "GRANTED", count: 1, firstAt: at("2026-06-01T10:00:00Z") },
      { deviceId: 3, result: "DENIED", count: 2, firstAt: at("2026-06-01T08:00:00Z") },
      { deviceId: null, result: "PROTECTED", count: 4, firstAt: at("2026-06-01T07:00:00Z") },
      { deviceId: 9, result: "GRANTED", count: 1, firstAt: at("2026-06-01T11:00:00Z") },
    ],
    (id) => (id ? names.get(id) : null) ?? "Web-Scanner",
  );
  assert.deepEqual(rows, [
    { name: "Drehkreuz Nord", granted: 1, denied: 2, total: 3 },
    { name: "Drehkreuz Sued", granted: 3, denied: 0, total: 3 },
    { name: "Web-Scanner", granted: 1, denied: 0, total: 1 },
  ]);
});
