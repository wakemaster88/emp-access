import { test } from "node:test";
import assert from "node:assert/strict";
import { csvQuote, csvText, csvTextCell } from "./csv-cell";

test("csvText: Texte mit Formelzeichen am Anfang bekommen ein Hochkomma", () => {
  for (const s of ["=1+1", "+49 123", "-Rabatt", "@SUMME(A1)", "\tTab", "\rCR"]) {
    assert.equal(csvText(s), `'${s}`);
  }
});

test("csvText: normale Texte bleiben unveraendert", () => {
  for (const s of ["", "Cola 0,33", "A=1", "Bahnmiete - A", "Jan@verein", "'schon"]) {
    assert.equal(csvText(s), s);
  }
});

test("csvQuote: Semikolon, Anfuehrungszeichen und Zeilenumbruch werden gequotet", () => {
  assert.equal(csvQuote("a;b"), '"a;b"');
  assert.equal(csvQuote('Sag "Hallo"'), '"Sag ""Hallo"""');
  assert.equal(csvQuote("a\nb"), '"a\nb"');
  assert.equal(csvQuote("ab"), "ab");
});

test("csvTextCell: erst Hochkomma, dann Anfuehrungszeichen", () => {
  assert.equal(csvTextCell("=HYPERLINK(\"x\";\"y\")"), '"\'=HYPERLINK(""x"";""y"")"');
  assert.equal(csvTextCell("\rText"), "\"'\rText\"");
  assert.equal(csvTextCell("Jugend"), "Jugend");
});
