import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePerson, parsePersonLook } from "./sentinel-rules.js";

const look = (o: Partial<ReturnType<typeof parsePersonLook>> = {}) => ({
  personen: 1, arbeitskleidung: false, mitarbeiter: false, verdaechtig: false, was: "", ...o,
});

test("Nahaufnahme-JSON robust lesen", () => {
  const l = parsePersonLook('Antwort: {"personen": 2, "arbeitskleidung": "ja", "mitarbeiter": true, "verdaechtig": false, "was": "Zwei Männer mit Warnweste"}');
  assert.equal(l.personen, 2);
  assert.equal(l.arbeitskleidung, true);
  assert.equal(l.mitarbeiter, true);
  assert.equal(l.verdaechtig, false);
  assert.equal(parsePersonLook("kaputt").personen, 1);
});

test("Eingestempelte Mitarbeiter tagsüber: kein Alarm", () => {
  const d = decidePerson({ face: null, staff: ["Jan", "Tim"], look: look({ personen: 2 }), hour: 14 });
  assert.equal(d.alarm, false);
  assert.match(d.reason, /Jan, Tim/);
});

test("Mehr Personen als eingestempelt: Alarm", () => {
  assert.equal(decidePerson({ face: null, staff: ["Jan"], look: look({ personen: 3, arbeitskleidung: true }), hour: 14 }).alarm, true);
});

test("Nachts eingestempelt nur mit Arbeitskleidung ohne Alarm", () => {
  assert.equal(decidePerson({ face: null, staff: ["Jan"], look: look(), hour: 23 }).alarm, true);
  assert.equal(decidePerson({ face: null, staff: ["Jan"], look: look({ arbeitskleidung: true }), hour: 23 }).alarm, false);
});

test("Gesicht Whitelist reicht, Blacklist und verdächtig immer Alarm", () => {
  assert.equal(decidePerson({ face: { name: "Jan", list: "WHITELIST" }, staff: [], look: null, hour: 2 }).alarm, false);
  assert.equal(decidePerson({ face: { name: "X", list: "BLACKLIST" }, staff: ["Jan"], look: look(), hour: 14 }).alarm, true);
  assert.equal(decidePerson({ face: { name: "Jan", list: "WHITELIST" }, staff: ["Jan"], look: look({ verdaechtig: true }), hour: 14 }).alarm, true);
});

test("Niemand eingestempelt oder keine Daten: Alarm", () => {
  assert.equal(decidePerson({ face: null, staff: [], look: look({ mitarbeiter: true }), hour: 14 }).alarm, true);
  assert.equal(decidePerson({ face: null, staff: null, look: look(), hour: 14 }).alarm, true);
});
