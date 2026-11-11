import assert from "node:assert/strict";
import { test } from "node:test";
import { filterNavGroups, firstNavMatch, navItemMatches, normalizeNavText } from "./nav-search";

const groups = [
  {
    label: "Übersicht",
    items: [
      { label: "Dashboard", keywords: ["start"] },
      { label: "Live-Monitor", keywords: ["einlass"] },
    ],
  },
  {
    label: "Zutritt",
    items: [
      { label: "Scanner", keywords: ["einlass"] },
      { label: "Schließanlage", keywords: ["schlüssel"] },
    ],
  },
  {
    label: "Gebäude & Technik",
    items: [
      { label: "Räume", keywords: ["klima", "heizung"] },
      { label: "Geräte", keywords: ["tor"] },
    ],
  },
];

test("normalizeNavText schreibt Umlaute aus und entfernt Satzzeichen", () => {
  assert.equal(normalizeNavText("  Schließ-Anlage & Räume "), "schliess anlage raeume");
});

test("Umlaute in beiden Schreibweisen finden denselben Eintrag", () => {
  const raeume = groups[2].items[0];
  assert.ok(navItemMatches(raeume, "", "räume"));
  assert.ok(navItemMatches(raeume, "", "raeu"));
  assert.ok(navItemMatches(raeume, "", "RÄU"));
});

test("Stichworte und Gruppenname zählen mit", () => {
  assert.ok(navItemMatches(groups[2].items[0], "Gebäude & Technik", "klima"));
  assert.ok(navItemMatches(groups[2].items[1], "Gebäude & Technik", "technik"));
});

test("nur Wortanfänge: „tor“ trifft Geräte, nicht Live-Monitor", () => {
  const hits = filterNavGroups(groups, "tor").flatMap((g) => g.items.map((i) => i.label));
  assert.deepEqual(hits, ["Geräte"]);
});

test("mehrere Wörter müssen alle passen", () => {
  const hits = filterNavGroups(groups, "einlass live").flatMap((g) => g.items.map((i) => i.label));
  assert.deepEqual(hits, ["Live-Monitor"]);
});

test("leere Suche liefert alle Gruppen unverändert, leere Gruppen fallen weg", () => {
  assert.equal(filterNavGroups(groups, "  "), groups);
  assert.deepEqual(
    filterNavGroups(groups, "klima").map((g) => g.label),
    ["Gebäude & Technik"],
  );
});

test("Enter nimmt den ersten Namenstreffer, sonst den ersten Treffer", () => {
  // „schl“: Schließanlage passt im Namen.
  assert.equal(firstNavMatch(filterNavGroups(groups, "schl"), "schl")?.label, "Schließanlage");
  // „einlass“ passt nur über Stichworte: erster Treffer in Menü-Reihenfolge.
  assert.equal(firstNavMatch(filterNavGroups(groups, "einlass"), "einlass")?.label, "Live-Monitor");
  // „zutritt“ passt nur über den Gruppennamen.
  assert.equal(firstNavMatch(filterNavGroups(groups, "zutritt"), "zutritt")?.label, "Scanner");
  assert.equal(firstNavMatch(filterNavGroups(groups, "xyz"), "xyz"), undefined);
});
