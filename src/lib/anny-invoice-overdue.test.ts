import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceOverdue, isOpenInvoiceStatus } from "./anny-sync";

const now = Date.parse("2026-11-21T12:00:00Z");

test("offen sind sent und overdue", () => {
  assert.equal(isOpenInvoiceStatus("sent"), true);
  assert.equal(isOpenInvoiceStatus("overdue"), true);
  assert.equal(isOpenInvoiceStatus("paid"), false);
  assert.equal(isOpenInvoiceStatus("draft"), false);
});

test("mit Fälligkeit zählt graceDays", () => {
  const inv = { status: "sent", dueDate: "2026-11-18T00:00:00Z", issuedAt: "2026-11-01T00:00:00Z" };
  assert.deepEqual(invoiceOverdue(inv, now, 0), { dueDate: "2026-11-18T00:00:00Z", overdue: true });
  assert.equal(invoiceOverdue(inv, now, 7).overdue, false);
  assert.equal(invoiceOverdue({ ...inv, status: "overdue" }, now, 7).overdue, true);
});

test("ohne Fälligkeit: Rechnungsdatum plus mindestens 14 Tage", () => {
  const fresh = { status: "sent", dueDate: null, issuedAt: "2026-11-15T00:00:00Z" };
  assert.deepEqual(invoiceOverdue(fresh, now, 0), { dueDate: "2026-11-15T00:00:00Z", overdue: false });
  const old = { ...fresh, issuedAt: "2026-11-01T00:00:00Z" };
  assert.equal(invoiceOverdue(old, now, 0).overdue, true);
  assert.equal(invoiceOverdue(old, now, 30).overdue, false);
});

test("ohne jedes Datum nur bei Status overdue", () => {
  assert.equal(invoiceOverdue({ status: "sent", dueDate: null, issuedAt: null }, now, 0).overdue, false);
  assert.equal(invoiceOverdue({ status: "overdue", dueDate: null, issuedAt: undefined }, now, 0).overdue, true);
});
