import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDebounce } from "./scan-debounce";

const previousScanTime = new Date("2026-08-25T12:28:45.795Z");
const now = new Date("2026-08-25T12:28:48.000Z"); // 2,2 s spaeter, im Fenster

test("Eintritt im Debounce-Fenster oeffnet nicht erneut", () => {
  const decision = resolveDebounce({
    previousResult: "GRANTED",
    previousScanTime,
    isExitScan: false,
    deviceLockSeconds: null,
    now,
  });
  assert.equal(decision.granted, false);
  assert.equal(decision.locked, false);
});

test("Geraete-Sperre liefert die Restzeit-Meldung", () => {
  const decision = resolveDebounce({
    previousResult: "GRANTED",
    previousScanTime,
    isExitScan: false,
    deviceLockSeconds: 60,
    now,
  });
  assert.equal(decision.granted, false);
  assert.equal(decision.locked, true);
  assert.match(decision.message, /\d/);
});

test("Ausgang im Debounce-Fenster oeffnet weiterhin", () => {
  const decision = resolveDebounce({
    previousResult: "GRANTED",
    previousScanTime,
    isExitScan: true,
    deviceLockSeconds: null,
    now,
  });
  assert.equal(decision.granted, true);
});

test("Abgewiesener Scan bleibt abgewiesen", () => {
  const decision = resolveDebounce({
    previousResult: "DENIED",
    previousScanTime,
    isExitScan: false,
    deviceLockSeconds: null,
    now,
  });
  assert.equal(decision.granted, false);
  assert.equal(decision.locked, false);
});
