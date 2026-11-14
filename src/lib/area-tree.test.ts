import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAreaTree, descendantIds, filterAreaTree, formatScanLock } from "./area-tree";

const areas = [
  { id: 1, name: "Ferienkurs", parentId: 11 },
  { id: 2, name: "Seilbahn A", parentId: 11 },
  { id: 5, name: "Aquapark", parentId: null },
  { id: 10, name: "Strandbad", parentId: null },
  { id: 11, name: "Wake & Ski", parentId: null },
  { id: 4, name: "Übungslift", parentId: 11 },
];

test("Unterressourcen stehen direkt unter ihrer Hauptressource, alles nach Namen", () => {
  const rows = buildAreaTree(areas);
  assert.deepEqual(
    rows.map((r) => [r.area.name, r.depth]),
    [
      ["Aquapark", 0],
      ["Strandbad", 0],
      ["Wake & Ski", 0],
      ["Ferienkurs", 1],
      ["Seilbahn A", 1],
      ["Übungslift", 1],
    ],
  );
  assert.equal(rows.find((r) => r.area.id === 11)?.childCount, 3);
  assert.equal(rows.find((r) => r.area.id === 4)?.isLast, true);
  assert.equal(rows.find((r) => r.area.id === 1)?.isLast, false);
});

test("fehlender Elternteil und Ringe lassen keinen Eintrag verschwinden", () => {
  const rows = buildAreaTree([
    { id: 1, name: "Waise", parentId: 99 },
    { id: 2, name: "A", parentId: 3 },
    { id: 3, name: "B", parentId: 2 },
    { id: 4, name: "Selbst", parentId: 4 },
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(new Set(rows.map((r) => r.area.id)), new Set([1, 2, 3, 4]));
});

test("als Elternteil gesperrt: die Ressource selbst und alle Nachfahren", () => {
  const list = [...areas, { id: 20, name: "Kabel", parentId: 2 }];
  assert.deepEqual([...descendantIds(list, 11)].sort((a, b) => a - b), [1, 2, 4, 11, 20]);
  assert.deepEqual([...descendantIds(list, 5)], [5]);
});

test("Suche zeigt Treffer mit ihrer Hauptressource", () => {
  const rows = filterAreaTree(buildAreaTree(areas), (a) => a.name.includes("Seilbahn"));
  assert.deepEqual(rows.map((r) => r.area.name), ["Wake & Ski", "Seilbahn A"]);
});

test("Sperrzeit lesbar", () => {
  assert.equal(formatScanLock(0), null);
  assert.equal(formatScanLock(null), null);
  assert.equal(formatScanLock(45), "45 Sek.");
  assert.equal(formatScanLock(120), "2 Min.");
  assert.equal(formatScanLock(3600), "1 Std.");
  assert.equal(formatScanLock(5400), "1,5 Std.");
});
