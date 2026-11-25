import { test } from "node:test";
import assert from "node:assert/strict";
import { REPORT_REJECTED_RETRY_MS, REPORT_RETRY_MS, reportDue, reportRetryMs, type ReportClock } from "./report-rules.js";

const MIN = 60_000;
const T0 = 1_000_000;

const clock = (o: Partial<ReportClock> = {}): ReportClock => ({
  today: "2026-11-22",
  hhmm: "20:00",
  reportTime: "20:00",
  lastReportDay: "2026-11-21",
  busy: false,
  retryAt: 0,
  now: T0,
  ...o,
});

test("Tagesbericht: fällig ab der Berichtszeit, einmal am Tag", () => {
  assert.equal(reportDue(clock({ hhmm: "19:59" })), false);
  assert.equal(reportDue(clock({ hhmm: "20:00" })), true);
  assert.equal(reportDue(clock({ hhmm: "23:59" })), true);
  assert.equal(reportDue(clock({ lastReportDay: "2026-11-22" })), false);
  assert.equal(reportDue(clock({ lastReportDay: null })), true);
  // Am naechsten Tag vor der Berichtszeit: noch nicht.
  assert.equal(reportDue(clock({ today: "2026-11-23", hhmm: "00:01", lastReportDay: "2026-11-22" })), false);
});

test("Tagesbericht: nicht, solange einer geschrieben oder gesendet wird", () => {
  assert.equal(reportDue(clock({ busy: true })), false);
});

test("Tagesbericht: hat er keinen Chat erreicht, bleibt der Tag offen und er kommt nach der Pause erneut", () => {
  // Der Tag gilt erst als erledigt, wenn lastReportDay gesetzt ist: Bis dahin bleibt der Bericht faellig.
  const retryAt = T0 + reportRetryMs(false);
  assert.equal(reportDue(clock({ now: T0 + 1, retryAt })), false);
  assert.equal(reportDue(clock({ now: retryAt - 1, retryAt })), false);
  assert.equal(reportDue(clock({ now: retryAt, retryAt })), true);
  assert.equal(reportDue(clock({ now: retryAt, retryAt, lastReportDay: "2026-11-22" })), false);
});

test("Tagesbericht: Pause 5 Minuten, nach einer Ablehnung durch Telegram eine Stunde", () => {
  assert.equal(reportRetryMs(false), REPORT_RETRY_MS);
  assert.equal(reportRetryMs(true), REPORT_REJECTED_RETRY_MS);
  assert.equal(REPORT_RETRY_MS, 5 * MIN);
  assert.equal(REPORT_REJECTED_RETRY_MS, 60 * MIN);
});
