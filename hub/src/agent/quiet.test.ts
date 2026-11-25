import { test } from "node:test";
import assert from "node:assert/strict";
import { berlinHour, hourFromParts, inQuietHours } from "./quiet.js";
import { decidePerson, shouldInspect } from "./sentinel-rules.js";

const at = (iso: string) => berlinHour(new Date(iso));

test("Ortszeit-Stunde: feste Zeitpunkte im Winter und im Sommer", () => {
  // Winter (MEZ, UTC+1)
  assert.equal(at("2026-11-22T15:02:50Z"), 16);
  assert.equal(at("2026-01-15T05:59:59Z"), 6);
  // Sommer (MESZ, UTC+2)
  assert.equal(at("2026-07-01T12:00:00Z"), 14);
  assert.equal(at("2026-07-01T19:59:59Z"), 21);
});

test("Ortszeit-Stunde: Mitternacht ist 0, nie 24", () => {
  assert.equal(at("2026-11-22T23:00:00Z"), 0);
  assert.equal(at("2026-11-22T23:59:59Z"), 0);
  assert.equal(at("2026-07-01T22:30:00Z"), 0);
  assert.equal(at("2026-11-22T22:59:59Z"), 23);
  assert.equal(at("2026-07-01T21:59:59Z"), 23);
});

test("Ortszeit-Stunde: ueber 24 Stunden immer eine ganze Zahl von 0 bis 23, jede genau einmal", () => {
  for (const [day, offset] of [
    ["2026-11-22", 1],
    ["2026-07-01", 2],
  ] as const) {
    const seen = new Set<number>();
    for (let utc = 0; utc < 24; utc++) {
      const h = berlinHour(new Date(Date.parse(`${day}T00:30:00Z`) + utc * 3_600_000));
      assert.ok(Number.isInteger(h) && h >= 0 && h <= 23, `${day} ${utc} UTC → ${h}`);
      assert.equal(h, (utc + offset) % 24);
      seen.add(h);
    }
    assert.equal(seen.size, 24);
  }
});

test("Ortszeit-Stunde: Umstellung auf Sommerzeit ueberspringt die Stunde 2", () => {
  assert.equal(at("2026-03-29T00:59:59Z"), 1);
  assert.equal(at("2026-03-29T01:00:00Z"), 3);
  const hours: number[] = [];
  // Der Tag hat 23 Stunden: 28.03. 23:00 UTC bis 29.03. 22:00 UTC.
  for (let i = 0; i < 23; i++) hours.push(berlinHour(new Date(Date.parse("2026-03-28T23:00:00Z") + i * 3_600_000)));
  assert.deepEqual(hours, [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
});

test("Ortszeit-Stunde: Umstellung auf Winterzeit zaehlt die Stunde 2 zweimal", () => {
  assert.equal(at("2026-10-25T00:59:59Z"), 2);
  assert.equal(at("2026-10-25T01:00:00Z"), 2);
  assert.equal(at("2026-10-25T02:00:00Z"), 3);
  const hours: number[] = [];
  // Der Tag hat 25 Stunden: 24.10. 22:00 UTC bis 25.10. 23:00 UTC.
  for (let i = 0; i < 25; i++) hours.push(berlinHour(new Date(Date.parse("2026-10-24T22:00:00Z") + i * 3_600_000)));
  assert.deepEqual(hours, [0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
});

test("Ortszeit-Stunde: ein ganzes Jahr stundenweise, nie etwas anderes als 0 bis 23", () => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < 366 * 24; i++) {
    const h = berlinHour(new Date(start + i * 3_600_000));
    if (!Number.isInteger(h) || h < 0 || h > 23) assert.fail(`Stunde ${h} bei ${new Date(start + i * 3_600_000).toISOString()}`);
  }
});

test("Ortszeit-Stunde: ohne Angabe gilt jetzt", () => {
  const h = berlinHour();
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 23);
});

test("Stunde lesen: nur der Teil „hour“ zaehlt, alles andere als 0 bis 23 wirft", () => {
  assert.equal(hourFromParts([{ type: "hour", value: "16" }]), 16);
  assert.equal(hourFromParts([{ type: "hour", value: "00" }]), 0);
  assert.equal(hourFromParts([{ type: "hour", value: "7" }]), 7);
  // Formatierung mit angehaengtem Wort: die Zahl steht im Teil „hour“.
  assert.equal(
    hourFromParts([
      { type: "hour", value: "16" },
      { type: "literal", value: " Uhr" },
    ]),
    16
  );
  assert.throws(() => hourFromParts([{ type: "hour", value: "16 Uhr" }]), /Stunde nicht lesbar/);
  assert.throws(() => hourFromParts([{ type: "hour", value: "24" }]), /Stunde nicht lesbar/);
  assert.throws(() => hourFromParts([{ type: "hour", value: "" }]), /Stunde nicht lesbar/);
  assert.throws(() => hourFromParts([{ type: "hour", value: "-1" }]), /Stunde nicht lesbar/);
  assert.throws(() => hourFromParts([{ type: "hour", value: "1.5" }]), /Stunde nicht lesbar/);
  assert.throws(() => hourFromParts([{ type: "minute", value: "16" }]), /fehlt/);
  assert.throws(() => hourFromParts([]), /fehlt/);
});

test("Ortszeit-Stunde: ungueltiger Zeitpunkt wirft, statt eine Nicht-Zahl zu liefern", () => {
  assert.throws(() => berlinHour(new Date(NaN)));
  assert.throws(() => berlinHour(new Date("kein Datum")));
});

test("Ruhezeit: ohne endliche Stunde nie Ruhezeit", () => {
  assert.equal(inQuietHours("22-7", 23), true);
  assert.equal(inQuietHours("22-7", NaN), false);
  assert.equal(inQuietHours("22-7", Infinity), false);
  assert.equal(inQuietHours("22-7", -Infinity), false);
  assert.equal(inQuietHours("1-5", NaN), false);
  assert.equal(inQuietHours("0", NaN), false);
  assert.equal(inQuietHours("", NaN), false);
});

test("Ruhezeit mit der Ortszeit-Stunde: 22 bis 7 Uhr, im Winter wie im Sommer", () => {
  const quiet = (iso: string) => inQuietHours("22-7", at(iso));
  assert.equal(quiet("2026-11-22T20:59:59Z"), false); // 21:59 MEZ
  assert.equal(quiet("2026-11-22T21:00:00Z"), true); // 22:00 MEZ
  assert.equal(quiet("2026-11-23T05:59:59Z"), true); // 06:59 MEZ
  assert.equal(quiet("2026-11-23T06:00:00Z"), false); // 07:00 MEZ
  assert.equal(quiet("2026-07-01T19:59:59Z"), false); // 21:59 MESZ
  assert.equal(quiet("2026-07-01T20:00:00Z"), true); // 22:00 MESZ
  assert.equal(quiet("2026-07-02T05:00:00Z"), false); // 07:00 MESZ
});

test("Waechter-Regeln mit der Ortszeit-Stunde: tagsueber eingestempelt kein Alarm, nachts schon", () => {
  const look = { personen: 1, arbeitskleidung: false, mitarbeiter: false, handlung: "keine" as const, was: "", kleidung: [], bekannt: [], unbekannt: 1 };
  const staff = ["Mitarbeiter A"];
  // 16:02 Ortszeit: eine Person, eine eingestempelt.
  assert.equal(decidePerson({ face: null, staff, look, hour: at("2026-11-22T15:02:50Z") }).alarm, false);
  // 08:20 Ortszeit.
  assert.equal(decidePerson({ face: null, staff, look, hour: at("2026-11-23T07:20:00Z") }).alarm, false);
  // 23:10 Ortszeit, ohne Arbeitskleidung.
  assert.equal(decidePerson({ face: null, staff, look, hour: at("2026-11-22T22:10:00Z") }).alarm, true);
});

test("Waechter-Regeln mit der Ortszeit-Stunde: Kamera ohne Betriebszeit wird im Nachtfenster bewacht", () => {
  const ev = { kind: "camera", title: "PERSON erkannt", where: "Kamera A" };
  const ctx = (iso: string) => ({
    closed: null,
    hour: at(iso),
    nightWindow: "22-6",
    always: false,
    lastInspectAt: undefined,
    now: Date.parse(iso),
    cooldownMs: 180_000,
    inspectionsLastHour: 0,
    maxPerHour: 30,
  });
  assert.equal(shouldInspect(ev, ctx("2026-11-22T21:30:46Z")), true); // 22:30 Ortszeit
  assert.equal(shouldInspect(ev, ctx("2026-11-23T04:59:00Z")), true); // 05:59
  assert.equal(shouldInspect(ev, ctx("2026-11-23T05:00:00Z")), false); // 06:00
  assert.equal(shouldInspect(ev, ctx("2026-11-22T15:02:50Z")), false); // 16:02
  // Ohne lesbare Stunde greift das Nachtfenster nicht.
  assert.equal(shouldInspect(ev, { ...ctx("2026-11-22T21:30:46Z"), hour: NaN }), false);
});
