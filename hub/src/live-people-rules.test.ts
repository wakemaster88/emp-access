import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSeen, personLabel, type SeenSource } from "./live-people-rules.js";

const src = (p: Partial<SeenSource>): SeenSource => ({ camera: "Halle", at: 1000, title: "", list: null, origin: "face", ...p });

test("Gesichtstreffer gibt den Namen", () => {
  assert.deepEqual(personLabel([src({ title: "Person erkannt: Jakob", list: "WHITELIST" })]), { text: "Jakob", kind: "face" });
});

test("Sperrliste gilt als auffällig", () => {
  assert.equal(personLabel([src({ title: "Person erkannt: X", list: "BLACKLIST" })])?.kind, "suspicious");
});

test("unbekanntes Gesicht überspringt zur nächsten Quelle", () => {
  const l = personLabel([
    src({ title: "Person unbekannt", at: 2000 }),
    src({ title: "Assistent: vermutlich Mitarbeiter", origin: "sentinel", at: 1500 }),
  ]);
  assert.deepEqual(l, { text: "Mitarbeiter", kind: "staff" });
});

test("Wiedererkennung über Kameras", () => {
  assert.deepEqual(personLabel([src({ title: "von Aaron freigegeben", origin: "cleared" })]), { text: "von Aaron freigegeben", kind: "cleared" });
  assert.equal(personLabel([src({ title: "Mitarbeiter", origin: "cleared" })])?.kind, "staff");
});

test("mergeSeen: aktive Kamera ohne Quelle ist unbekannte Person, aktive zuerst", () => {
  const rows = mergeSeen(
    [
      { id: 1, name: "Halle", person: false },
      { id: 2, name: "Shop", person: true },
      { id: 3, name: "Leer", person: false },
    ],
    [src({ title: "Person erkannt: Jakob", at: 5000 })],
    6000
  );
  assert.deepEqual(rows.map((r) => [r.camera, r.label, r.kind, r.active]), [
    ["Shop", "Person", "unknown", true],
    ["Halle", "Jakob", "face", false],
  ]);
});
