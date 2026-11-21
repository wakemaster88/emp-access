import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysOverdue, openAmount, paymentOpenInfo, paymentOpenScanMessage, paymentOpenSentence,
  paymentOpenTotal, sortPaymentOpen,
} from "./payment-open";

const extras = {
  paymentPause: { since: "2026-11-01T00:00:00Z", amount: 24, openTotal: 48, openCount: 2, currency: "eur", dueDate: "2026-10-21T00:00:00Z", invoiceNumber: "R-1" },
};

test("paymentOpenInfo liest den Vermerk und ignoriert Fremdes", () => {
  assert.equal(paymentOpenInfo(null), null);
  assert.equal(paymentOpenInfo({ pausedAt: "x" }), null);
  assert.equal(paymentOpenInfo([]), null);
  const info = paymentOpenInfo(extras)!;
  assert.equal(info.amount, 24);
  assert.equal(openAmount(info), 48);
  assert.equal(openAmount({ ...info, openTotal: null }), 24);
});

test("Scan-Text und Satz", () => {
  const info = paymentOpenInfo(extras)!;
  assert.equal(paymentOpenScanMessage(null), "Zahlung offen");
  assert.match(paymentOpenScanMessage(info), /^Zahlung offen · 48\s€$/);
  const s = paymentOpenSentence(info, new Date("2026-11-21T12:00:00Z"));
  assert.match(s, /^48\s€ offen aus 2 Rechnungen, fällig seit 21\.10\.2026 \(31 Tage\)\.$/);
  assert.equal(paymentOpenSentence(paymentOpenInfo({ paymentPause: {} })!), "Eine Abo-Rechnung ist offen.");
});

test("daysOverdue zählt ganze Tage, nie negativ", () => {
  const info = paymentOpenInfo(extras)!;
  assert.equal(daysOverdue(info, new Date("2026-10-21T10:00:00Z")), 0);
  assert.equal(daysOverdue(info, new Date("2026-10-01T00:00:00Z")), 0);
  assert.equal(daysOverdue({ ...info, dueDate: null }), null);
});

test("Sortierung und Summe je Währung", () => {
  const rows = sortPaymentOpen([
    { dueDate: null, amount: 5, currency: "EUR" },
    { dueDate: "2026-11-01", amount: 10.1, currency: "eur" },
    { dueDate: "2026-10-01", amount: 20.2, currency: "EUR" },
  ]);
  assert.deepEqual(rows.map((r) => r.dueDate), ["2026-10-01", "2026-11-01", null]);
  assert.match(paymentOpenTotal(rows)!, /^35,30\s€$/);
  assert.equal(paymentOpenTotal([]), null);
});
