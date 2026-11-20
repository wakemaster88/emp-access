import { test } from "node:test";
import assert from "node:assert/strict";
import { aboSource, personKey, personLabel, suggestEmails } from "./abos-without-email";

const P = (firstName: string | null, lastName: string | null, email: string | null = null, name = "Ticket") => ({ name, firstName, lastName, email });

test("aboSource: Herkunft an der uuid", () => {
  assert.equal(aboSource("reepay:sub-123"), "reepay");
  assert.equal(aboSource("anny-sub:5:9"), "anny");
  assert.equal(aboSource(null), "manual");
  assert.equal(aboSource("9f0c-…"), "manual");
});

test("personKey und personLabel: Vor- und Nachname, sonst der Ticketname", () => {
  assert.equal(personKey(P("Lea", "Mü-ller")), personKey(P("lea", "Müller")));
  assert.equal(personKey(P(null, null, null, "Lea Müller")), "leamuller");
  assert.equal(personLabel(P("Lea", "Müller")), "Lea Müller");
  assert.equal(personLabel(P(null, null, null, "Gruppe Nord")), "Gruppe Nord");
});

test("suggestEmails: genau eine Adresse je Person wird Vorschlag", () => {
  const map = suggestEmails([
    P("Lea", "Müller", "Lea@Example.de"),
    P("lea", "müller", "lea@example.de "),
    P("Tom", "Krause", "tom@example.de"),
    P("Tom", "Krause", "papa@example.de"),
    P("Ida", "Lang", null),
  ]);
  assert.equal(map.get(personKey(P("Lea", "Müller"))), "lea@example.de");
  assert.equal(map.has(personKey(P("Tom", "Krause"))), false);
  assert.equal(map.has(personKey(P("Ida", "Lang"))), false);
});
