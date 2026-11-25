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

test("Stoerung je Kamera und Grund: wechseln sich zwei Gruende ab, kommt jeder einmal je Frist", () => {
  const c = new ChangeLog(5 * 60_000);
  const line = (cameraId: number, reason: string, at: number) => c.shouldLog(`${cameraId}:${reason}`, reason, at);
  assert.equal(line(3, "fetch failed", 0), true);
  assert.equal(line(3, "HTTP 503", 2_000), true);
  assert.equal(line(3, "fetch failed", 4_000), false);
  assert.equal(line(3, "HTTP 503", 6_000), false);
  // Eine andere Kamera hat ihre eigene Zeile.
  assert.equal(line(7, "fetch failed", 8_000), true);
  assert.equal(line(3, "fetch failed", 5 * 60_000), true);
});
