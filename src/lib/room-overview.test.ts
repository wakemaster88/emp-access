import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLooseItems, normalizeName, placeWord, splitByKind, suggestRoom, UNCLEAR_LABEL, type LooseItem } from "./room-overview";

const rooms = [
  { id: 1, name: "Umkleide" },
  { id: 5, name: "Umkleide Damen" },
  { id: 20, name: "Büro" },
  { id: 4, name: "Strandbad" },
];

const item = (key: string, name: string, kind: LooseItem["kind"] = "device"): LooseItem => ({
  key,
  kind,
  id: Number(key.slice(1)),
  name,
  meta: "Shelly",
});

test("normalizeName löst Umlaute auf und trennt an Sonderzeichen", () => {
  assert.equal(normalizeName("Büro-Tür (Aaron)"), "buero tuer aaron");
});

test("suggestRoom nimmt den längsten passenden Raumnamen", () => {
  assert.equal(suggestRoom("Beleuchtung Umkleide Damen 1", rooms)?.id, 5);
  assert.equal(suggestRoom("Umkleide Herren Heizung", rooms)?.id, 1);
});

test("suggestRoom matcht nur ganze Wörter und über Umlaute hinweg", () => {
  assert.equal(suggestRoom("Buero Drucker", rooms)?.id, 20);
  assert.equal(suggestRoom("Strandbadweg Lampe", rooms), null);
});

test("placeWord überspringt Gerätewörter und Zahlen", () => {
  assert.equal(placeWord("Beleuchtung Halle 2"), "halle");
  assert.equal(placeWord("Shelly 1 Kopie"), null);
});

test("groupLooseItems: Vorschläge zuerst, dann Ortswörter, zuletzt Unklar", () => {
  const groups = groupLooseItems(
    [
      item("d1", "Strandbad Beleuchtung Steg"),
      item("c2", "Strandbad Kamera Süd", "camera"),
      item("d3", "Halle Rolltor"),
      item("d4", "Halle Licht"),
      item("d5", "Halle Taster"),
      item("d6", "Test Shelly"),
      item("z7", "Büro", "zone"),
    ],
    rooms,
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.suggestedRoom?.id ?? null, g.items.length]),
    [
      ["Strandbad", 4, 2],
      ["Büro", 20, 1],
      ["Halle", null, 3],
      [UNCLEAR_LABEL, null, 1],
    ],
  );
});

test("splitByKind trennt nach Art", () => {
  const split = splitByKind([item("d1", "a"), item("c2", "b", "camera"), item("z3", "c", "zone"), item("d4", "d")]);
  assert.deepEqual(split, { deviceIds: [1, 4], cameraIds: [2], zoneIds: [3] });
});
