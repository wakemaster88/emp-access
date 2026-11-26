import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { RULE_EVENT_TYPES, RULE_EVENT_TYPE_LABELS } from "./rule-event-types";
import { roomRuleCreateSchema, roomRuleUpdateSchema } from "./validators";

const ROOT = path.resolve(__dirname, "..", "..");
const BEWEGUNG = { name: "Licht bei Person", trigger: "MOTION", roomId: 3 };

test("Anlegen und Aendern nehmen jede Ereignisart an, auch die Klingel", () => {
  for (const eventType of RULE_EVENT_TYPES) {
    assert.equal(roomRuleCreateSchema.safeParse({ ...BEWEGUNG, eventType }).success, true, `anlegen ${eventType}`);
    assert.equal(roomRuleUpdateSchema.safeParse({ eventType }).success, true, `aendern ${eventType}`);
  }
  assert.equal(roomRuleCreateSchema.safeParse({ ...BEWEGUNG, eventType: null }).success, true, "jede Ereignisart");
});

test("unbekannte Ereignisarten bleiben abgelehnt", () => {
  for (const eventType of ["ANIMAL", "OTHER", "person", ""]) {
    assert.equal(roomRuleCreateSchema.safeParse({ ...BEWEGUNG, eventType }).success, false, `anlegen ${eventType}`);
    assert.equal(roomRuleUpdateSchema.safeParse({ eventType }).success, false, `aendern ${eventType}`);
  }
});

test("Hub-Dialog bietet genau die Ereignisarten der Liste an", () => {
  const html = readFileSync(path.join(ROOT, "hub/src/ui/dashboard.html"), "utf8");
  const select = /<select[^>]*name="eventType"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(select, "Auswahl eventType im Hub-Dialog");
  const options = [...select[1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => ({
    value: m[1],
    label: m[2],
  }));
  assert.deepEqual(
    options.filter((o) => o.value !== "").map((o) => o.value),
    [...RULE_EVENT_TYPES],
  );
  for (const o of options) {
    if (o.value) assert.equal(o.label, RULE_EVENT_TYPE_LABELS[o.value as keyof typeof RULE_EVENT_TYPE_LABELS]);
  }
});

test("Cloud-Dialog baut die Auswahl aus der Liste", () => {
  const tsx = readFileSync(path.join(ROOT, "src/components/regeln/rule-dialog.tsx"), "utf8");
  assert.match(tsx, /RULE_EVENT_TYPES\.map/);
  for (const t of RULE_EVENT_TYPES) {
    assert.equal(tsx.includes(`value="${t}"`), false, `${t} nicht fest eingetragen`);
  }
});
