import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERSON_MARK_LIMIT,
  PERSON_MIN_CONF,
  groupRect,
  headRect,
  largestFirst,
  parsePersons,
} from "./person-crop-rules.js";
import { COUNT_PERSON_LIMIT } from "./occupancy-rules.js";

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

/** Antwort von /classify mit `n` Personen, die sicherste zuerst (wie der Tracker sortiert). */
function trackerAnswer(n: number) {
  return {
    people: n,
    persons: Array.from({ length: n }, (_, i) => ({ conf: 0.95 - i * 0.001, x: (i % 20) / 20, y: 0.4, w: 0.02, h: 0.1 })),
  };
}

test("parsePersons: 30 Personen ergeben 30 bei limit 200 und 20 beim Standard", () => {
  assert.equal(PERSON_MARK_LIMIT, 20);
  assert.equal(COUNT_PERSON_LIMIT, 200);
  assert.equal(parsePersons(trackerAnswer(30), { minConf: PERSON_MIN_CONF, limit: COUNT_PERSON_LIMIT })?.length, 30);
  const marks = parsePersons(trackerAnswer(30), { minConf: PERSON_MIN_CONF, limit: PERSON_MARK_LIMIT })!;
  assert.equal(marks.length, 20);
  // Die sichersten bleiben vorn.
  assert.equal(marks[0].conf, 0.95);
  assert.equal(parsePersons(trackerAnswer(250), { minConf: PERSON_MIN_CONF, limit: COUNT_PERSON_LIMIT })?.length, 200);
});

test("parsePersons: unsichere, leere und kaputte Boxen zählen nicht; ohne Box-Liste null", () => {
  const json = {
    persons: [
      { conf: 0.9, x: 0.1, y: 0.1, w: 0.1, h: 0.3 },
      { conf: 0.3, x: 0.2, y: 0.1, w: 0.1, h: 0.3 },
      { conf: 0.35, x: 0.3, y: 0.1, w: 0.1, h: 0.3 },
      { conf: 0.5, x: 0.2, y: 0.1, w: 0, h: 0.3 },
      { conf: 0.5, x: "a", y: 0.1, w: 0.1, h: 0.3 },
      { x: 0.4, y: 0.1, w: 0.1, h: 0.3 },
      null,
      { conf: "0.6", x: "0.5", y: 0.1, w: 0.1, h: 0.3 },
    ],
  };
  const got = parsePersons(json, { minConf: PERSON_MIN_CONF, limit: 20 })!;
  assert.deepEqual(
    got.map((p) => [p.conf, p.x]),
    [
      [0.9, 0.1],
      [0.35, 0.3],
      [0.6, 0.5],
    ],
  );
  assert.equal(parsePersons({ vehicle: true, conf: 0.6 }, { minConf: PERSON_MIN_CONF, limit: 20 }), null);
  assert.equal(parsePersons({ persons: "x" }, { minConf: PERSON_MIN_CONF, limit: 20 }), null);
  assert.equal(parsePersons(null, { minConf: PERSON_MIN_CONF, limit: 20 }), null);
  assert.deepEqual(parsePersons({ persons: [] }, { minConf: PERSON_MIN_CONF, limit: 20 }), []);
});
