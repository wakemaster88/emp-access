import { test } from "node:test";
import assert from "node:assert/strict";
import { isKioskPath, isNewerBuild } from "./app-version";

test("isNewerBuild erkennt nur echte Abweichungen", () => {
  assert.equal(isNewerBuild("dpl_a", "dpl_b"), true);
  assert.equal(isNewerBuild("dpl_a", "dpl_a"), false);
  assert.equal(isNewerBuild("dpl_a", null), false);
  assert.equal(isNewerBuild("dpl_a", ""), false);
  assert.equal(isNewerBuild("dev", "dpl_b"), false);
  assert.equal(isNewerBuild("dpl_a", "dev"), false);
});

test("isKioskPath trennt Kiosk-Seiten von der App", () => {
  assert.equal(isKioskPath("/monitor/abc"), true);
  assert.equal(isKioskPath("/resource-monitor/abc"), true);
  assert.equal(isKioskPath("/scanner/abc"), true);
  assert.equal(isKioskPath("/checkin/abc"), true);
  assert.equal(isKioskPath("/m/abc"), false);
  assert.equal(isKioskPath("/monitors"), false);
  assert.equal(isKioskPath("/"), false);
});
