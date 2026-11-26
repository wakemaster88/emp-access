import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTriggeredRules, ruleReport, triggeredRuleLine } from "./rule-report-rules.js";

const ANTWORT = {
  ok: true,
  created: 1,
  rulesTriggered: 1,
  rules: [{ ruleId: 7, name: "Licht Einfahrt", state: "ok", durationMs: 940, cameraId: 3, camera: "Einfahrt", type: "PERSON" }],
};

test("ruleReport: je genannter Regel eine Zeile mit Kamera, Ereignisart und Antwortzeit", () => {
  assert.deepEqual(ruleReport(ANTWORT, 1432), {
    lines: ["Regel „Licht Einfahrt“ ausgelöst: Einfahrt, Person, Antwort der Cloud nach 1,4 s (Lauf 0,9 s, erledigt)"],
    unnamed: 0,
  });
});

test("ruleReport: ältere Cloud nennt nur die Zahl, dann wird gezählt statt geloggt", () => {
  assert.deepEqual(ruleReport({ ok: true, rulesTriggered: 2 }, 800), { lines: [], unnamed: 2 });
  assert.deepEqual(ruleReport({ ok: true, rulesTriggered: 0 }, 800), { lines: [], unnamed: 0 });
  assert.deepEqual(ruleReport(null, 800), { lines: [], unnamed: 0 });
});

test("triggeredRuleLine: Übergabe an den Hub und fehlende Angaben", () => {
  assert.equal(
    triggeredRuleLine({ ruleId: 1, name: "Klingel", camera: "Tor", type: "DOORBELL", state: "uebergeben", durationMs: 120 }, 300),
    "Regel „Klingel“ ausgelöst: Tor, Klingel, Antwort der Cloud nach 0,3 s (Lauf 0,1 s, an Hub übergeben)",
  );
  assert.equal(
    triggeredRuleLine({ ruleId: 1, name: "X", camera: "Kamera #4", type: "", state: null, durationMs: null }, 2080),
    "Regel „X“ ausgelöst: Kamera #4, Ereignis, Antwort der Cloud nach 2,1 s",
  );
});

test("parseTriggeredRules: unbrauchbare Einträge fallen heraus, ohne Kameranamen die Nummer", () => {
  assert.deepEqual(parseTriggeredRules({ rules: [{ name: "ohne Nummer" }, { ruleId: 2, name: "B", cameraId: 9, type: "MOTION" }] }), [
    { ruleId: 2, name: "B", camera: "Kamera #9", type: "MOTION", state: null, durationMs: null },
  ]);
  assert.equal(parseTriggeredRules({ rulesTriggered: 1 }), null);
});
