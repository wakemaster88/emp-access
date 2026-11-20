import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, annyContractStart, annyRunningEnd, minimumTermMonths, reconstructAnnyStart } from "./anny-sub-dates";

const d = (s: string) => new Date(s);

test("Vertragsbeginn: der früheste bekannte Beginn bleibt", () => {
  // anny meldet im November den Novemberzeitraum, das Ticket kennt Mai.
  assert.equal(annyContractStart(d("2026-11-02T13:48:19Z"), d("2026-05-02T13:48:19Z"))?.toISOString(), "2026-05-02T13:48:19.000Z");
  assert.equal(annyContractStart(d("2026-05-02T13:48:19Z"), null)?.toISOString(), "2026-05-02T13:48:19.000Z");
  assert.equal(annyContractStart(null, d("2026-05-02T13:48:19Z"))?.toISOString(), "2026-05-02T13:48:19.000Z");
  assert.equal(annyContractStart(null, null), null);
});

test("Monate addieren am Monatsende", () => {
  assert.equal(addMonths(d("2026-01-31T10:00:00Z"), 1).toISOString(), "2026-02-28T10:00:00.000Z");
  assert.equal(addMonths(d("2026-05-02T13:48:19Z"), 24).toISOString(), "2028-05-02T13:48:19.000Z");
  assert.equal(addMonths(d("2026-11-02T13:48:19Z"), -6).toISOString(), "2026-05-02T13:48:19.000Z");
});

test("Laufendes Ende: in der Mindestlaufzeit gilt das Vertragsende", () => {
  const end = d("2028-05-02T13:48:19Z");
  assert.equal(annyRunningEnd(end, d("2026-11-02T13:48:19Z"), true)?.toISOString(), end.toISOString());
});

test("Laufendes Ende: nach der Mindestlaufzeit bis Ende des Abrechnungsmonats", () => {
  const end = d("2027-05-02T13:48:19Z");
  assert.equal(annyRunningEnd(end, d("2027-06-02T13:48:19Z"), true)?.toISOString(), "2027-07-02T13:48:19.000Z");
  // gekündigt/inaktiv: kein Weiterlaufen
  assert.equal(annyRunningEnd(end, d("2027-06-02T13:48:19Z"), false)?.toISOString(), end.toISOString());
});

test("Vertragsbeginn zurückrechnen (Fall Ratschow)", () => {
  // Kids Abo 24M: erster Abgleich 02.05.2026 13:05, verschobener Beginn 02.11.2026 13:48
  assert.equal(reconstructAnnyStart(d("2026-11-02T13:48:19Z"), d("2026-05-02T13:05:24Z")).toISOString(), "2026-05-02T13:48:19.000Z");
  // Ride Abo 24M: erster Abgleich 29.05.2026, Beginn 29.10.2026
  assert.equal(reconstructAnnyStart(d("2026-10-29T16:41:46Z"), d("2026-05-29T15:54:49Z")).toISOString(), "2026-05-29T16:41:46.000Z");
  // Nicht verschoben: bleibt
  assert.equal(reconstructAnnyStart(d("2026-11-20T12:38:16Z"), d("2026-11-20T13:05:00Z")).toISOString(), "2026-11-20T12:38:16.000Z");
});

test("Vertragsbeginn: created_at von anny zählt als Kauf", () => {
  // März-Abo: Ticket kennt nur den verschobenen Beginn, anny die Anlage
  assert.equal(
    annyContractStart(d("2026-11-13T17:42:37Z"), d("2026-11-13T17:42:37Z"), d("2026-02-13T17:40:00Z"))?.toISOString(),
    "2026-02-13T17:40:00.000Z",
  );
  assert.equal(annyContractStart(d("2026-11-13T17:42:37Z"), null, new Date("kaputt"))?.toISOString(), "2026-11-13T17:42:37.000Z");
});

test("Mindestlaufzeit aus anny in Monaten", () => {
  assert.equal(minimumTermMonths(12, "month"), 12);
  assert.equal(minimumTermMonths(2, "year"), 24);
  assert.equal(minimumTermMonths(24, undefined), 24);
  assert.equal(minimumTermMonths(0, "month"), null);
  assert.equal(minimumTermMonths(3, "week"), null);
});
