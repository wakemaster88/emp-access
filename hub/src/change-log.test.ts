import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeLog } from "./change-log.js";

test("Routinezeile nur bei geaendertem Inhalt", () => {
  const c = new ChangeLog();
  assert.equal(c.shouldLog("wl", "14 Einträge", 0), true);
  assert.equal(c.shouldLog("wl", "14 Einträge", 300_000), false);
  assert.equal(c.shouldLog("wl", "15 Einträge", 600_000), true);
  assert.equal(c.shouldLog("gallery", "14 Einträge", 600_000), true);
});

test("Routinezeile: mit Wiederholfrist einmal je Frist zur Erinnerung", () => {
  const c = new ChangeLog(1_000);
  assert.equal(c.shouldLog("k", "gleich", 0), true);
  assert.equal(c.shouldLog("k", "gleich", 999), false);
  assert.equal(c.shouldLog("k", "gleich", 1_000), true);
});
