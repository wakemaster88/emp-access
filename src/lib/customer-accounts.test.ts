import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateGroups } from "./customer-accounts";

const C = (id: number, name: string | null, anny: string[] = []) => ({ id, name, annyCustomerIds: anny });

test("findDuplicateGroups: gleicher Inhabername, Groß/Klein und Leerraum egal", () => {
  const groups = findDuplicateGroups([C(1, "Eva Beispiel"), C(2, "eva  beispiel"), C(3, "Max Muster")]);
  assert.deepEqual(groups, [{ reason: "name", label: "Eva Beispiel", ids: [1, 2] }]);
});

test("findDuplicateGroups: ein einzelnes Wort ist kein Vorschlag", () => {
  assert.deepEqual(findDuplicateGroups([C(1, "Familie"), C(2, "Familie"), C(3, null), C(4, null)]), []);
});

test("findDuplicateGroups: gleiche anny-Kundennummer, Gruppe nur einmal", () => {
  const groups = findDuplicateGroups([C(5, "Eva Beispiel", ["77"]), C(9, "Eva Beispiel", ["77"]), C(7, "Max Muster", ["12"])]);
  assert.deepEqual(groups, [{ reason: "anny", label: "", ids: [5, 9] }]);
});

test("findDuplicateGroups: drei Konten mit gleichem Namen", () => {
  const groups = findDuplicateGroups([C(3, "Jo Ko"), C(1, "Jo Ko"), C(2, "Jo Ko")]);
  assert.deepEqual(groups, [{ reason: "name", label: "Jo Ko", ids: [1, 2, 3] }]);
});
