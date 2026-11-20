import { test } from "node:test";
import assert from "node:assert/strict";
import { ABO_EMAIL_KEEP, ABO_EMAIL_REQUIRED, aboEmailError, cleanEmail } from "./abo-email";

test("cleanEmail: ohne Leerraum, klein, leer wird null", () => {
  assert.equal(cleanEmail("  Max@Example.DE "), "max@example.de");
  assert.equal(cleanEmail("   "), null);
  assert.equal(cleanEmail(null), null);
  assert.equal(cleanEmail(undefined), null);
});

test("aboEmailError: neues Abo braucht eine Adresse", () => {
  assert.equal(aboEmailError(null, { subscriptionId: 3, email: "" }), ABO_EMAIL_REQUIRED);
  assert.equal(aboEmailError(null, { subscriptionId: 3, email: null }), ABO_EMAIL_REQUIRED);
  assert.equal(aboEmailError(null, { subscriptionId: 3, email: "a@b.de" }), null);
});

test("aboEmailError: Tickets ohne Abo brauchen keine Adresse", () => {
  assert.equal(aboEmailError(null, { subscriptionId: null, email: null }), null);
  assert.equal(aboEmailError({ subscriptionId: null, email: "a@b.de" }, { subscriptionId: null, email: null }), null);
});

test("aboEmailError: Ticket wird zum Abo, dann braucht es eine Adresse", () => {
  assert.equal(aboEmailError({ subscriptionId: null, email: null }, { subscriptionId: 3, email: null }), ABO_EMAIL_REQUIRED);
});

test("aboEmailError: Adresse am Abo lässt sich ändern, aber nicht entfernen", () => {
  assert.equal(aboEmailError({ subscriptionId: 3, email: "a@b.de" }, { subscriptionId: 3, email: "c@d.de" }), null);
  assert.equal(aboEmailError({ subscriptionId: 3, email: "a@b.de" }, { subscriptionId: 3, email: " " }), ABO_EMAIL_KEEP);
  assert.equal(aboEmailError({ subscriptionId: 3, email: "a@b.de" }, { subscriptionId: 4, email: null }), ABO_EMAIL_KEEP);
});

test("aboEmailError: ältere Abos ohne Adresse bleiben bearbeitbar", () => {
  assert.equal(aboEmailError({ subscriptionId: 3, email: null }, { subscriptionId: 3, email: null }), null);
});
