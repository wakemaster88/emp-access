import { test } from "node:test";
import assert from "node:assert/strict";
import { isKioskPath, isNewerBuild, pickReleaseNotes, showsReleaseNotes } from "./app-version";

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

test("pickReleaseNotes nimmt nur PRs zwischen den beiden Builds", () => {
  const pulls = [
    { title: "Alt", merged_at: "2026-11-15T10:00:00Z" },
    { title: "Kunden-App: Glas-Navigation", merged_at: "2026-11-15T17:00:00Z" },
    { title: "Offen", merged_at: null },
    { title: "Revert \"Irgendwas\"", merged_at: "2026-11-15T17:10:00Z" },
    { title: "Update-Hinweis mit Neuerungen", merged_at: "2026-11-15T18:00:00Z" },
    { title: "Noch nicht deployt", merged_at: "2026-11-15T20:00:00Z" },
  ];
  assert.deepEqual(pickReleaseNotes(pulls, "2026-11-15T12:00:00Z", "2026-11-15T19:00:00Z"), [
    "Update-Hinweis mit Neuerungen",
    "Kunden-App: Glas-Navigation",
  ]);
  assert.deepEqual(pickReleaseNotes(pulls, "kaputt", "2026-11-15T19:00:00Z"), []);
});

test("showsReleaseNotes nur auf Seiten fürs Team", () => {
  assert.equal(showsReleaseNotes("/"), true);
  assert.equal(showsReleaseNotes("/tickets"), true);
  assert.equal(showsReleaseNotes("/app/abc"), false);
  assert.equal(showsReleaseNotes("/m/abc"), false);
});
