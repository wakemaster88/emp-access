import { test } from "node:test";
import assert from "node:assert/strict";
import { equalsInsensitive, escapeLike } from "./like-escape";

/** ILIKE nachgestellt: `_` ein Zeichen, `%` beliebig viele, `\` maskiert das nächste Zeichen. */
function ilike(value: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "_") {
      re += ".";
    } else if (c === "%") {
      re += ".*";
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "is").test(value);
}

test("escapeLike: maskiert Unterstrich, Prozent und Backslash", () => {
  assert.equal(escapeLike("anna_schmidt@example.org"), "anna\\_schmidt@example.org");
  assert.equal(escapeLike("50%"), "50\\%");
  assert.equal(escapeLike("a\\b"), "a\\\\b");
  assert.equal(escapeLike("max.mustermann@example.org"), "max.mustermann@example.org");
});

test("ohne Maskierung trifft der Unterstrich fremde Adressen, mit Maskierung nicht", () => {
  const mine = "anna_schmidt@example.org";
  const other = "anna.schmidt@example.org";
  assert.equal(ilike(other, mine), true);
  assert.equal(ilike(other, escapeLike(mine)), false);
  assert.equal(ilike(mine, escapeLike(mine)), true);
  assert.equal(ilike("Anna_Schmidt@Example.org", escapeLike(mine)), true);
});

test("Prozentzeichen und Backslash werden wörtlich verglichen", () => {
  assert.equal(ilike("Bier 5 Liter Fass", "Bier 5%"), true);
  assert.equal(ilike("Bier 5 Liter Fass", escapeLike("Bier 5%")), false);
  assert.equal(ilike("Bier 5%", escapeLike("Bier 5%")), true);
  assert.equal(ilike("a\\b", escapeLike("a\\b")), true);
  assert.equal(ilike("aXb", escapeLike("a\\b")), false);
});

test("equalsInsensitive: Filter für Prisma", () => {
  assert.deepEqual(equalsInsensitive("a_b@example.org"), { equals: "a\\_b@example.org", mode: "insensitive" });
});
