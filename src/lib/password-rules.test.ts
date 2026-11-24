import { test } from "node:test";
import assert from "node:assert/strict";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "./password-rules";

test("passwordProblem: brauchbares Passwort", () => {
  assert.equal(passwordProblem("Seilbahn-fahren-macht-Laune"), null);
  assert.equal(passwordProblem("k7#Vq2!zP0rt"), null);
});

test("passwordProblem: zu kurz, leer, kein Text", () => {
  assert.match(passwordProblem("kurz") ?? "", new RegExp(`mindestens ${PASSWORD_MIN_LENGTH}`));
  assert.ok(passwordProblem(""));
  assert.ok(passwordProblem(undefined));
  assert.ok(passwordProblem(123456789012));
});

test("passwordProblem: zu lang", () => {
  assert.ok(passwordProblem("a1b2c3".repeat(40)));
});

test("passwordProblem: zu einfach oder verbreitet", () => {
  assert.ok(passwordProblem("aaaaaaaaaaaa"));
  assert.ok(passwordProblem("abababababab"));
  assert.ok(passwordProblem("Passwort1234"));
  assert.ok(passwordProblem("ADMINISTRATOR"));
});

test("passwordProblem: enthaelt die eigene Adresse", () => {
  assert.ok(passwordProblem("aaron.muster2026", { email: "Aaron.Muster@example.de" }));
  assert.ok(passwordProblem("aaron.muster@example.de", { email: "aaron.muster@example.de" }));
  // Kurze Namensteile (unter 4 Zeichen) wuerden zu viel treffen.
  assert.equal(passwordProblem("Seilbahn-Abo-2027", { email: "abo@example.de" }), null);
});
