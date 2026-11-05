import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFindings, newWatchState, openFindings } from "./findings.js";

const cam = { key: "cam:5", severity: "warn" as const, title: "Kamera Seilbahn A nicht erreichbar" };
const cloud = { key: "cloud", severity: "alert" as const, title: "Cloud nicht erreichbar" };

test("Warnung erst nach zwei Pruefungen, Entwarnung nur wenn gemeldet", () => {
  const st = newWatchState();
  assert.deepEqual(diffFindings(st, [cam], 0).opened, []);
  assert.deepEqual(diffFindings(st, [cam], 300_000).opened, [cam]);
  assert.deepEqual(diffFindings(st, [cam], 600_000).opened, []);
  assert.deepEqual(openFindings(st), [cam]);
  const d = diffFindings(st, [], 900_000);
  assert.equal(d.resolved.length, 1);
  assert.equal(d.resolved[0].sinceMs, 900_000);
});

test("Einmaliger Aussetzer wird nicht gemeldet und nicht entwarnt", () => {
  const st = newWatchState();
  diffFindings(st, [cam], 0);
  assert.deepEqual(diffFindings(st, [], 300_000), { opened: [], resolved: [] });
});

test("Alarm geht sofort raus", () => {
  const st = newWatchState();
  assert.deepEqual(diffFindings(st, [cloud], 0).opened, [cloud]);
});

import { inQuietHours } from "./quiet.js";

test("Ruhezeit über Mitternacht", () => {
  assert.equal(inQuietHours("22-7", 23), true);
  assert.equal(inQuietHours("22-7", 3), true);
  assert.equal(inQuietHours("22-7", 7), false);
  assert.equal(inQuietHours("22-7", 12), false);
  assert.equal(inQuietHours("0", 3), false);
  assert.equal(inQuietHours("1-5", 2), true);
});
