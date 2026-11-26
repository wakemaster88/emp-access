import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX_FRAME_MAX_AGE_MS, PREV_MAX_AGE_MS, assignBoxLabels, boxesUsable, mergeSeen, personLabel, type SeenSource } from "./live-people-rules.js";

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

test("Gesichts-Treffer benennt die Box, in deren Kopfbereich er liegt", () => {
  const now = 100_000;
  const boxes = [
    { conf: 0.9, x: 0.1, y: 0.2, w: 0.1, h: 0.4 }, // groesser, links
    { conf: 0.9, x: 0.6, y: 0.3, w: 0.08, h: 0.3 }, // rechts
  ];
  const jakob = { text: "Jakob", kind: "face" as const };
  const out = assignBoxLabels(boxes, [{ at: now - 2000, x: 0.64, y: 0.34, label: jakob }], null, jakob, now);
  assert.equal(out[0], null);
  assert.deepEqual(out[1], jakob);
});

test("Name wandert mit der Person, ohne Lage bei mehreren Personen kein geratener Name", () => {
  const now = 200_000;
  const jakob = { text: "Jakob", kind: "face" as const };
  const prev = {
    at: now - 1000,
    boxes: [
      { conf: 0.9, x: 0.1, y: 0.2, w: 0.1, h: 0.4, label: null },
      { conf: 0.9, x: 0.6, y: 0.3, w: 0.08, h: 0.3, label: jakob },
    ],
  };
  const moved = [
    { conf: 0.9, x: 0.12, y: 0.2, w: 0.1, h: 0.4 },
    { conf: 0.9, x: 0.65, y: 0.31, w: 0.08, h: 0.3 },
  ];
  const out = assignBoxLabels(moved, [], prev, jakob, now);
  assert.equal(out[0], null);
  assert.deepEqual(out[1], jakob);

  // Alte Abfrage, kein frischer Treffer, zwei Personen: niemand wird benannt.
  const stale = assignBoxLabels(moved, [], { ...prev, at: now - 60_000 }, jakob, now);
  assert.deepEqual(stale, [null, null]);

  // Eine Person: Kamera-Name wie bisher.
  assert.deepEqual(assignBoxLabels([moved[1]], [], null, jakob, now), [jakob]);
  // Zu weit gesprungen: kein Weitertragen.
  assert.deepEqual(assignBoxLabels([{ conf: 0.9, x: 0.1, y: 0.7, w: 0.05, h: 0.2 }, moved[0]], [], prev, null, now), [null, null]);
});

test("Boxen nur auf frischem Bild: frisch ja, 3,5 s alt, Ersatz und unbekanntes Alter nein", () => {
  assert.equal(boxesUsable(200, false), true);
  assert.equal(boxesUsable(BOX_FRAME_MAX_AGE_MS, false), true);
  assert.equal(boxesUsable(3500, false), false);
  // Ersatz aus dem Speicher, weil go2rtc nichts lieferte: auch wenn er jung ist.
  assert.equal(boxesUsable(500, true), false);
  assert.equal(boxesUsable(null, false), false);
  assert.equal(boxesUsable(Number.NaN, false), false);
  assert.equal(boxesUsable(-5, false), false);
});

test("Nach einer Lücke ohne frisches Bild trägt die nächste Abfrage keinen Namen weiter", () => {
  const named = { text: "Gast", kind: "cleared" as const };
  const box = { conf: 0.9, x: 0.4, y: 0.3, w: 0.1, h: 0.4 };
  // Letzte frische Abfrage; danach nur veraltete Bilder (lastFrame bleibt so stehen).
  const last = { at: 1_000_000, boxes: [{ ...box, label: named }, { ...box, x: 0.1, label: null }] };
  const now = last.at + PREV_MAX_AGE_MS + 1000;
  // Zwei Personen und kein Gesichtstreffer: ohne Weitertragen bleibt jede Box ohne Namen.
  assert.deepEqual(assignBoxLabels([box, { ...box, x: 0.1 }], [], last, null, now), [null, null]);
  // Innerhalb der Frist wandert der Name dagegen mit.
  assert.deepEqual(assignBoxLabels([box, { ...box, x: 0.1 }], [], last, null, last.at + 1000), [named, null]);
});
