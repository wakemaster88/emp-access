import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupPauseAllResume,
  pauseAllMarkable,
  pauseAllResumeStatus,
  stripPauseAllMarker,
  withPauseAllMarker,
} from "./pause-all-marker";

const AT = new Date("2026-11-25T10:00:00.000Z");
const AT_ISO = AT.toISOString();

test("withPauseAllMarker: Kennung, Status davor und Zeitpunkt, übrige Schlüssel bleiben", () => {
  assert.deepEqual(withPauseAllMarker(null, "VALID", AT), { pausedBy: "pause-all", pauseAllPrevStatus: "VALID", pauseAllAt: AT_ISO });
  const orig = { note: "x", paymentPause: undefined };
  const marked = withPauseAllMarker(orig, "REDEEMED", AT);
  assert.deepEqual(marked, { note: "x", paymentPause: undefined, pausedBy: "pause-all", pauseAllPrevStatus: "REDEEMED", pauseAllAt: AT_ISO });
  // Das Original bleibt unverändert.
  assert.deepEqual(orig, { note: "x", paymentPause: undefined });
});

test("pauseAllMarkable: nur leere Extras oder Objekte", () => {
  assert.equal(pauseAllMarkable(null), true);
  assert.equal(pauseAllMarkable(undefined), true);
  assert.equal(pauseAllMarkable({ a: 1 }), true);
  assert.equal(pauseAllMarkable([1]), false);
  assert.equal(pauseAllMarkable("x"), false);
  assert.equal(pauseAllMarkable(3), false);
});

test("stripPauseAllMarker: entfernt nur die Schlüssel der Kennung", () => {
  assert.deepEqual(
    stripPauseAllMarker({ a: 1, pausedBy: "pause-all", pauseAllPrevStatus: "VALID", pauseAllAt: AT_ISO, previousStatus: "VALID" }),
    { a: 1, previousStatus: "VALID" },
  );
});

test("pauseAllResumeStatus: nur mit Kennung und ohne andere Pause", () => {
  assert.equal(pauseAllResumeStatus(null), null);
  assert.equal(pauseAllResumeStatus({}), null);
  // Vor diesem Paket pausiert: keine Kennung.
  assert.equal(pauseAllResumeStatus({ pausedAtMs: 1, remainingMs: 2, previousStatus: "VALID" }), null);
  assert.equal(pauseAllResumeStatus({ pausedBy: "jemand" }), null);
  assert.equal(pauseAllResumeStatus({ pausedBy: "pause-all", pauseAllPrevStatus: "VALID" }), "VALID");
  assert.equal(pauseAllResumeStatus({ pausedBy: "pause-all", pauseAllPrevStatus: "REDEEMED" }), "REDEEMED");
  assert.equal(pauseAllResumeStatus({ pausedBy: "pause-all", pauseAllPrevStatus: "PAUSED" }), "VALID");
  assert.equal(pauseAllResumeStatus({ pausedBy: "pause-all" }), "VALID");
  // Seitdem einzeln (pausedAt) oder wegen offener Zahlung pausiert: bleibt pausiert.
  assert.equal(pauseAllResumeStatus({ pausedBy: "pause-all", pauseAllPrevStatus: "VALID", pausedAt: "2026-11-25T10:00:00Z" }), null);
  assert.equal(pauseAllResumeStatus({ pausedBy: "pause-all", pauseAllPrevStatus: "VALID", paymentPause: { since: "x" } }), null);
  // Zahlungs-Pause zählt auch, wenn `since` älter ist (der Abgleich behält es).
  assert.equal(
    pauseAllResumeStatus({ pausedBy: "pause-all", pauseAllAt: AT_ISO, paymentPause: { since: "2026-11-01T08:00:00Z" } }),
    null,
  );
});

test("pauseAllResumeStatus: pausedAt zählt nur, wenn es nach „Alle pausieren“ gesetzt wurde", () => {
  const base = { pausedBy: "pause-all", pauseAllPrevStatus: "VALID", pauseAllAt: AT_ISO };
  // Übrig aus einer früheren, schon aufgehobenen Einzel-Pause: wird fortgesetzt.
  assert.equal(pauseAllResumeStatus({ ...base, pausedAt: "2026-11-20T09:00:00.000Z" }), "VALID");
  // Nach „Alle pausieren“ einzeln pausiert: bleibt pausiert.
  assert.equal(pauseAllResumeStatus({ ...base, pausedAt: "2026-11-25T10:05:00.000Z" }), null);
  // Zeitpunkte nicht lesbar: bleibt pausiert.
  assert.equal(pauseAllResumeStatus({ ...base, pausedAt: "unbekannt" }), null);
  assert.equal(pauseAllResumeStatus({ pausedBy: "pause-all", pausedAt: "2026-11-20T09:00:00.000Z" }), null);
});

test("groupPauseAllResume: IDs je Zielstatus", () => {
  assert.deepEqual(
    groupPauseAllResume([
      { id: 1, extras: { pausedBy: "pause-all", pauseAllPrevStatus: "VALID" } },
      { id: 2, extras: { pausedBy: "pause-all", pauseAllPrevStatus: "REDEEMED" } },
      { id: 3, extras: null },
      { id: 4, extras: { pausedBy: "pause-all", paymentPause: {} } },
    ]),
    { VALID: [1], REDEEMED: [2] },
  );
});
