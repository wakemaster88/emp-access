import { test } from "node:test";
import assert from "node:assert/strict";
import { isAnnyPaymentEvent, isPaidInvoiceStatus, parseAnnyInvoiceEvent } from "./anny-payment-webhook";

test("isAnnyPaymentEvent trennt Rechnungen/Abos von Buchungen", () => {
  assert.equal(isAnnyPaymentEvent("invoices.updated"), true);
  assert.equal(isAnnyPaymentEvent("subscriptions.charged"), true);
  assert.equal(isAnnyPaymentEvent("bookings.created"), false);
});

test("flache Rechnung mit reference", () => {
  const e = parseAnnyInvoiceEvent("invoices.updated", {
    id: 77, status: "paid", formatted_number: "RE-2026-1", reference: { id: 123, type: "plan-subscriptions" },
  })!;
  assert.deepEqual(e, { event: "invoices.updated", invoiceId: "77", invoiceNumber: "RE-2026-1", status: "paid", subscriptionId: "123" });
  assert.equal(isPaidInvoiceStatus(e.status), true);
});

test("reference_id/-type und JSON:API", () => {
  assert.equal(
    parseAnnyInvoiceEvent("invoices.updated", { id: "1", status: "sent", reference_type: "PlanSubscription", reference_id: "9" })!.subscriptionId,
    "9",
  );
  const j = parseAnnyInvoiceEvent("invoices.finalised", {
    id: "2", attributes: { status: "PAID", number: "N2" }, relationships: { reference: { data: { type: "plan-subscriptions", id: "5" } } },
  })!;
  assert.equal(j.subscriptionId, "5");
  assert.equal(j.invoiceNumber, "N2");
  assert.equal(isPaidInvoiceStatus(j.status), true);
});

test("Rechnung zu einer Buchung hat keine Abo-id; andere Events null", () => {
  assert.equal(parseAnnyInvoiceEvent("invoices.updated", { id: 1, status: "paid", reference: { id: 4, type: "bookings" } })!.subscriptionId, null);
  assert.equal(parseAnnyInvoiceEvent("subscriptions.charged", { id: 1 }), null);
  assert.equal(isPaidInvoiceStatus("sent"), false);
});
