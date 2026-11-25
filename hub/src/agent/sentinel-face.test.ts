import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLACKLIST_LEAD_MS,
  FACE_LEAD_MS,
  FACE_STRONG_ANY,
  FACE_STRONG_DIRECT,
  decidePerson,
  faceIsStrong,
  parsePersonLook,
  pickFaceHit,
  type FaceHit,
  type PersonContext,
  type TimedFaceHit,
} from "./sentinel-rules.js";

const NAME = "Person A";
const white = (score: number | undefined, upscaled: boolean | undefined): FaceHit => ({ name: NAME, list: "WHITELIST", score, upscaled });
const look = (o: Record<string, unknown> = {}) => parsePersonLook(JSON.stringify({ personen: 1, kleidung: ["Person 1: graue Jacke"], ...o }));
const ctx = (o: Partial<PersonContext>): PersonContext => ({ face: null, staff: [], look: look(), hour: 14, tracked: 1, ...o });

test("Starker Treffer: nicht hochgerechnet ab 0,60, sonst ab 0,70; ohne Angaben schwach", () => {
  assert.equal(FACE_STRONG_DIRECT, 0.6);
  assert.equal(FACE_STRONG_ANY, 0.7);
  const cases: Array<[number | undefined, boolean | undefined, boolean]> = [
    [0.6, false, true],
    [0.599, false, false],
    [0.72, false, true],
    [0.69, true, false],
    [0.7, true, true],
    [0.75, true, true],
    // Ereignis eines aelteren Stands: Score oder „hochgerechnet“ fehlt.
    [0.65, undefined, false],
    [0.75, undefined, false],
    [undefined, false, false],
    [Number.NaN, false, false],
  ];
  for (const [score, upscaled, strong] of cases) assert.equal(faceIsStrong({ score, upscaled }), strong, `${score} ${upscaled}`);
});

test("Gesichts-Treffer fuer eine Bewertung: ab 10 s vor dem Ausloeser, Sperrliste gewinnt, sonst der staerkste", () => {
  const T = 1_000_000;
  const hit = (o: Partial<TimedFaceHit>): TimedFaceHit => ({ at: T, name: NAME, list: "WHITELIST", score: 0.65, upscaled: false, ...o });
  assert.equal(FACE_LEAD_MS, 10_000);
  // Aelter als 10 s vor dem Ausloeser: zaehlt nicht (frueherer Passant).
  assert.equal(pickFaceHit([hit({ at: T - 11_000 })], T), null);
  assert.deepEqual(pickFaceHit([hit({ at: T - 9_000 })], T), { name: NAME, list: "WHITELIST", score: 0.65, upscaled: false });
  // Ein spaeterer Whitelist-Treffer ueberschreibt die Sperrliste nicht.
  const black = hit({ at: T + 5_000, name: "Person B", list: "BLACKLIST", score: 0.52, upscaled: true });
  assert.equal(pickFaceHit([black, hit({ at: T + 20_000, score: 0.8 })], T)?.list, "BLACKLIST");
  // Die Sperrliste zaehlt weiter ab 90 s vor dem Ausloeser.
  assert.equal(BLACKLIST_LEAD_MS, 90_000);
  assert.equal(pickFaceHit([{ ...black, at: T - 60_000 }, hit({ at: T + 3_000 })], T)?.list, "BLACKLIST");
  assert.equal(pickFaceHit([{ ...black, at: T - 91_000 }], T), null);
  // Stark vor schwach, dann der hoechste Score.
  const weakHigh = hit({ at: T + 1_000, name: "Person C", score: 0.68, upscaled: true });
  const strongLow = hit({ at: T + 2_000, name: "Person D", score: 0.61, upscaled: false });
  assert.equal(pickFaceHit([weakHigh, strongLow], T)?.name, "Person D");
  assert.equal(pickFaceHit([strongLow, hit({ at: T + 3_000, name: "Person E", score: 0.66 })], T)?.name, "Person E");
  assert.equal(pickFaceHit([], T), null);
});

test("Gesichts-Treffer: der stärkste zählt, nicht der jüngste", () => {
  const T = 1_000_000;
  const hit = (o: Partial<TimedFaceHit>): TimedFaceHit => ({ at: T, name: NAME, list: "WHITELIST", score: 0.65, upscaled: false, ...o });
  // Zuerst ein starker Treffer, danach ein schwacher: Der starke zählt.
  const strong = hit({ at: T + 1_000, name: "Person A", score: 0.65, upscaled: false });
  const weakLater = hit({ at: T + 2_000, name: "Person B", score: 0.62, upscaled: true });
  assert.deepEqual(pickFaceHit([strong, weakLater], T), { name: "Person A", list: "WHITELIST", score: 0.65, upscaled: false });
  // Zwei starke: Der ältere mit dem höheren Score zählt.
  const strongHigh = hit({ at: T + 1_000, name: "Person C", score: 0.74, upscaled: false });
  const strongLater = hit({ at: T + 4_000, name: "Person D", score: 0.63, upscaled: false });
  assert.equal(pickFaceHit([strongHigh, strongLater], T)?.name, "Person C");
  // Auch ein schwacher Treffer mit hohem Score verdrängt einen früheren starken nicht.
  assert.equal(pickFaceHit([strong, hit({ at: T + 3_000, name: "Person E", score: 0.69, upscaled: true })], T)?.name, "Person A");
  // Gleich stark und gleicher Score: dann der jüngste.
  assert.equal(pickFaceHit([hit({ at: T + 1_000, name: "Person F" }), hit({ at: T + 2_000, name: "Person G" })], T)?.name, "Person G");
});

test("Schwacher Whitelist-Treffer allein: Alarm", () => {
  const d = decidePerson(ctx({ face: white(0.5, true) }));
  assert.equal(d.alarm, true);
  assert.equal(d.basis, "niemand");
  // Der Grund nennt den Hinweis mit Score, ohne Namen.
  assert.match(d.reason, /vermutlich bekannt \(Score 0,50\), allein zu unsicher/);
  assert.doesNotMatch(d.reason, new RegExp(NAME));
  // Auch nachts und ohne Stempeldaten.
  assert.equal(decidePerson(ctx({ face: white(0.5, true), hour: 2 })).alarm, true);
  assert.equal(decidePerson(ctx({ face: white(0.5, true), staff: null, hour: 2 })).alarm, true);
});

test("Schwacher Treffer mit zweitem Signal: kein Alarm, „vermutlich bekannt“ ohne Namen", () => {
  // Eingestempelt, auch nachts ohne Arbeitskleidung.
  const staff = decidePerson(ctx({ face: white(0.5, true), staff: ["Mitarbeiter A"], hour: 23 }));
  assert.equal(staff.alarm, false);
  assert.equal(staff.basis, "hinweis");
  assert.equal(staff.reason, "Vermutlich bekannt (Score 0,50), eingestempelt");
  // Tagsueber Arbeitskleidung oder Taetigkeit laut Bildmodell.
  const work = decidePerson(ctx({ face: white(0.554, true), look: look({ arbeitskleidung: true }), hour: 10 }));
  assert.equal(work.basis, "hinweis");
  assert.doesNotMatch(work.reason, new RegExp(NAME));
  assert.equal(decidePerson(ctx({ face: white(0.554, true), look: look({ mitarbeiter: true }), hour: 10 })).basis, "hinweis");
  // Nachts zaehlen Arbeitskleidung und Taetigkeit nicht.
  assert.equal(decidePerson(ctx({ face: white(0.554, true), look: look({ arbeitskleidung: true }), hour: 23 })).alarm, true);
  // Schon gesehen als freigegeben.
  const seen = decidePerson(
    ctx({ face: white(0.561, true), look: look({ bekannt: [1], unbekannt: 0 }), known: ["freigegeben (Kamera A 10:00)"], knownKinds: ["freigegeben"], hour: 23 }),
  );
  assert.equal(seen.basis, "hinweis");
  assert.match(seen.reason, /schon gesehen als freigegeben/);
});

test("Starker Treffer: allein kein Alarm bei einer Person, Alarm bei zwei", () => {
  const one = decidePerson(ctx({ face: white(0.72, false), hour: 2 }));
  assert.equal(one.alarm, false);
  assert.equal(one.basis, "gesicht");
  assert.match(one.reason, /Score 0,72/);
  // Das Bildmodell zaehlt zwei Personen.
  const two = decidePerson(ctx({ face: white(0.72, false), look: look({ personen: 2 }), hour: 2 }));
  assert.equal(two.alarm, true);
  assert.match(two.reason, /aber 2 Personen im Bild/);
  // Der Tracker zaehlt zwei, die Nahaufnahme eine.
  assert.equal(decidePerson(ctx({ face: white(0.72, false), tracked: 2, hour: 2 })).alarm, true);
  // Ohne jede Personenzahl entwarnt das Gesicht nicht allein.
  assert.equal(decidePerson(ctx({ face: white(0.72, false), look: null, tracked: null, hour: 2 })).alarm, true);
  // Zwei Personen, beide eingestempelt: Die Stempeldaten entscheiden wie ohne Gesicht.
  assert.equal(decidePerson(ctx({ face: white(0.72, false), look: look({ personen: 2 }), staff: ["Mitarbeiter A", "Mitarbeiter B"], hour: 14 })).alarm, false);
});

test("Sperrliste loest immer Alarm aus", () => {
  const black: FaceHit = { name: "Person B", list: "BLACKLIST", score: 0.46, upscaled: true };
  for (const o of [{}, { staff: ["Mitarbeiter A"] }, { look: look({ arbeitskleidung: true }) }, { hour: 2 }]) {
    const d = decidePerson(ctx({ face: black, ...o }));
    assert.equal(d.alarm, true);
    assert.equal(d.basis, "gesperrt");
  }
});

/**
 * Scores der Gesichts-Entwarnungen aus dem Log (0,469 bis 0,686; dreimal mit
 * zwei Personen laut Bildmodell), hier ohne Stempeldaten und ohne weiteres
 * Signal: Allein entwarnt nur, was stark ist und bei einer Person liegt.
 */
test("Entwarnungen aus dem Log: nur starke Treffer bei einer Person entwarnen allein", () => {
  const cases: Array<[number, boolean, number, boolean]> = [
    // score, hochgerechnet, Personen, Alarm
    [0.469, false, 1, true],
    [0.554, false, 1, true],
    [0.558, false, 1, true],
    [0.565, false, 1, true],
    [0.602, false, 1, false],
    [0.677, false, 1, false],
    [0.686, false, 1, false],
    [0.602, true, 1, true],
    [0.686, true, 1, true],
    [0.602, false, 2, true],
    [0.677, false, 2, true],
    [0.686, false, 2, true],
  ];
  for (const [score, upscaled, personen, alarm] of cases) {
    const d = decidePerson(ctx({ face: white(score, upscaled), look: look({ personen }), tracked: personen }));
    assert.equal(d.alarm, alarm, `${score} ${upscaled} ${personen}`);
  }
});
