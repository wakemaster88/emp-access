import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRect, headRect, largestFirst } from "./person-crop-rules.js";

test("Kopf-Ausschnitt liegt im Bild und oben in der Person", () => {
  const r = headRect({ x: 0.5, y: 0.4, w: 0.04, h: 0.2 });
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1);
  assert.ok(r.y < 0.4 + 0.2 * 0.4);
  assert.ok(r.w >= 0.04);
  const edge = headRect({ x: 0.98, y: 0, w: 0.02, h: 0.1 });
  assert.ok(edge.x + edge.w <= 1 && edge.y >= 0);
});

test("Gruppen-Ausschnitt umfasst alle Personen, große Gruppen werden nicht beschnitten", () => {
  const r = groupRect([{ x: 0.1, y: 0.5, w: 0.05, h: 0.15 }, { x: 0.3, y: 0.55, w: 0.05, h: 0.12 }])!;
  assert.ok(r.x <= 0.1 && r.x + r.w >= 0.35 && r.y <= 0.5 && r.y + r.h >= 0.67);
  assert.equal(groupRect([{ x: 0, y: 0, w: 0.9, h: 0.9 }]), null);
  assert.equal(groupRect([]), null);
});

test("größte Personen zuerst", () => {
  const l = largestFirst([{ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0, y: 0, w: 0.3, h: 0.3 }], 1);
  assert.equal(l[0].w, 0.3);
});
