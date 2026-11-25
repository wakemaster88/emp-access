import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePerson, parsePersonLook, readHandlung, type FaceHit, type Handlung, type PersonContext } from "./sentinel-rules.js";

const look = (o: Partial<ReturnType<typeof parsePersonLook>> = {}) => ({
  personen: 1, arbeitskleidung: false, mitarbeiter: false, handlung: "keine" as Handlung, was: "", kleidung: [], bekannt: [], unbekannt: 1, ...o,
});

test("Nahaufnahme-JSON robust lesen", () => {
  const l = parsePersonLook('Antwort: {"personen": 2, "arbeitskleidung": "ja", "mitarbeiter": true, "verdaechtig": false, "was": "Zwei Männer mit Warnweste"}');
  assert.equal(l.personen, 2);
  assert.equal(l.arbeitskleidung, true);
  assert.equal(l.mitarbeiter, true);
  assert.equal(l.handlung, "keine");
  assert.equal(parsePersonLook("kaputt").personen, 1);
  assert.equal(parsePersonLook("kaputt").handlung, "keine");
});

test("Handlung lesen: feste Werte, freie Schreibweisen, Liste, unbekannter Wert", () => {
  const cases: Array<[unknown, Handlung | null]> = [
    ["klettern", "klettern"],
    ["tuer_fenster_schloss", "tuer_fenster_schloss"],
    ["Tür/Fenster/Schloss", "tuer_fenster_schloss"],
    ["hantiert an der Tür", "tuer_fenster_schloss"],
    ["versteckt", "versteckt"],
    ["vermummt", "vermummt"],
    ["traegt_etwas", "traegt_etwas"],
    ["trägt etwas", "traegt_etwas"],
    // Farbe ist keine Tuer.
    ["trägt türkise Kiste", "traegt_etwas"],
    ["keine", "keine"],
    ["keine Handlung", "keine"],
    [false, "keine"],
    // Mehrere Werte: der schwerste gilt.
    [["traegt_etwas", "klettern"], "klettern"],
    [["keine", "vermummt"], "vermummt"],
    // Nicht zuzuordnen: zaehlt als unklar (harte Handlung, im Zweifel Alarm).
    ["rennt weg", "unklar"],
    ["verdaechtig", "unklar"],
    // Kein Wert.
    ["", null],
    [undefined, null],
    [null, null],
    [[], null],
  ];
  for (const [raw, want] of cases) assert.equal(readHandlung(raw), want, JSON.stringify(raw));
});

test("Altes Antwortformat: ein Ja bei verdaechtig ohne Handlung zaehlt wie bisher als verdaechtig", () => {
  const read = (o: Record<string, unknown>) => parsePersonLook(JSON.stringify({ personen: 1, ...o })).handlung;
  assert.equal(read({ verdaechtig: true }), "verdaechtig");
  assert.equal(read({ verdächtig: "ja" }), "verdaechtig");
  assert.equal(read({ verdaechtig: false }), "keine");
  assert.equal(read({}), "keine");
  // Widerspruch „keine“ und Ja: im Zweifel verdaechtig.
  assert.equal(read({ handlung: "keine", verdaechtig: true }), "verdaechtig");
  // Nennt die Antwort eine Handlung, entscheidet diese.
  assert.equal(read({ handlung: "traegt_etwas", verdaechtig: true }), "traegt_etwas");
  assert.equal(read({ handlung: "klettern", verdaechtig: false }), "klettern");
});

test("Unklare Handlung: der Grund nennt den Wert der Antwort", () => {
  const l = parsePersonLook('{"personen":1,"handlung":"rennt weg"}');
  assert.equal(l.handlung, "unklar");
  assert.equal(l.handlungText, "rennt weg");
  assert.equal(parsePersonLook('{"personen":1,"handlung":"keine"}').handlungText, undefined);
  const d = decidePerson({ face: null, staff: [], look: l, hour: 14 });
  assert.equal(d.basis, "verdaechtig");
  assert.equal(d.reason, "Verhalten wirkt verdächtig: Handlung nicht eindeutig („rennt weg“)");
});

/**
 * Faelle aus den Alarmen „Verhalten wirkt verdächtig“ (ohne Namen, Zeit und
 * Kamera): Antwort des Bildmodells im neuen Format und die Lage, in der sie
 * kam. Gesichter: stark = nicht hochgerechnet mit Score 0,66; schwach =
 * hochgerechnet mit Score 0,554 (so lag einer der Treffer vor solchen Alarmen).
 */
test("Verdaechtig enger gefasst: Tabelle der Faelle", () => {
  const strong: FaceHit = { name: "Person A", list: "WHITELIST", score: 0.66, upscaled: false };
  const weak: FaceHit = { name: "Person A", list: "WHITELIST", score: 0.554, upscaled: true };
  type Kind = "gemeldet" | "freigegeben" | "mitarbeiter";
  const cases: Array<{
    fall: string;
    answer: Record<string, unknown>;
    face?: FaceHit | null;
    staff?: string[] | null;
    hour?: number;
    /** Die eine Person im Bild steht als Eintrag dieser Art auf der Merkliste. */
    seenAs?: Kind;
    tracked?: number | null;
    alarm: boolean;
    basis: string;
  }> = [
    { fall: "Rucksack, Gesicht erkannt", answer: { handlung: "keine", was: "Person mit Rucksack geht über den Weg" }, face: strong, alarm: false, basis: "gesicht" },
    { fall: "Einkaufstasche, freigegeben", answer: { handlung: "keine", was: "Person mit Einkaufstasche" }, seenAs: "freigegeben", alarm: false, basis: "bekannt" },
    { fall: "Kapuze bei Kälte, Gesicht erkannt", answer: { handlung: "keine", was: "Person mit Kapuze" }, face: strong, alarm: false, basis: "gesicht" },
    { fall: "Kapuze, altes Format verdächtig, Gesicht erkannt", answer: { verdaechtig: true, was: "Person mit Kapuze" }, face: strong, alarm: true, basis: "verdaechtig" },
    { fall: "Karton, Gesicht erkannt", answer: { handlung: "traegt_etwas", was: "Person trägt einen Karton" }, face: strong, alarm: false, basis: "gesicht" },
    { fall: "Karton, unbekannt, niemand eingestempelt", answer: { handlung: "traegt_etwas", was: "Person trägt einen Karton" }, alarm: true, basis: "ohne_freigabe" },
    { fall: "Karton, Gesicht erkannt, zwei Personen", answer: { personen: 2, handlung: "traegt_etwas", was: "Zwei Personen tragen Kisten" }, face: strong, alarm: true, basis: "ohne_freigabe" },
    { fall: "Einkaufswagen, schwacher Treffer", answer: { handlung: "traegt_etwas", was: "Person schiebt einen Einkaufswagen" }, face: weak, alarm: true, basis: "ohne_freigabe" },
    { fall: "Heizkörper, tagsüber eingestempelt", answer: { handlung: "traegt_etwas", was: "Person trägt einen Heizkörper" }, staff: ["Mitarbeiter A"], hour: 10, alarm: false, basis: "eingestempelt" },
    { fall: "Heizkörper, eingestempelt, nachts", answer: { handlung: "traegt_etwas", arbeitskleidung: true, was: "Person trägt einen Heizkörper" }, staff: ["Mitarbeiter A"], hour: 23, alarm: true, basis: "ohne_freigabe" },
    { fall: "Teller mit Essen, freigegeben", answer: { handlung: "traegt_etwas", was: "Person trägt einen Teller mit Essen" }, seenAs: "freigegeben", alarm: false, basis: "bekannt" },
    { fall: "Gießkanne, schon gemeldet", answer: { handlung: "traegt_etwas", was: "Person trägt eine Gießkanne" }, seenAs: "gemeldet", alarm: true, basis: "ohne_freigabe" },
    { fall: "Gießkanne, Mitarbeiter-Eintrag", answer: { handlung: "traegt_etwas", was: "Person trägt eine Gießkanne" }, seenAs: "mitarbeiter", hour: 10, alarm: true, basis: "ohne_freigabe" },
    {
      fall: "Widersprüchlich: wie Mitarbeiter bei der Reinigung, trägt Sachen weg, schwacher Treffer",
      answer: { handlung: "traegt_etwas", mitarbeiter: true, was: "Wirkt wie ein Mitarbeiter bei der Reinigung, trägt Sachen weg" },
      face: weak,
      hour: 10,
      alarm: true,
      basis: "ohne_freigabe",
    },
    { fall: "Offene Ladentür, Gesicht erkannt", answer: { handlung: "tuer_fenster_schloss", was: "Person an der offenen Ladentür" }, face: strong, alarm: true, basis: "verdaechtig" },
    { fall: "Fahrzeugtür, tagsüber eingestempelt", answer: { handlung: "tuer_fenster_schloss", was: "Person an einer Fahrzeugtür" }, staff: ["Mitarbeiter A"], hour: 10, alarm: true, basis: "verdaechtig" },
    { fall: "Klettert, freigegeben", answer: { handlung: "klettern", was: "Person klettert über den Zaun" }, seenAs: "freigegeben", alarm: true, basis: "verdaechtig" },
    { fall: "Versteckt sich, tagsüber eingestempelt", answer: { handlung: "versteckt", was: "Person duckt sich hinter einen Container" }, staff: ["Mitarbeiter A"], hour: 10, alarm: true, basis: "verdaechtig" },
    { fall: "Unbekannter Wert, Gesicht erkannt", answer: { handlung: "rennt weg", was: "Person rennt" }, face: strong, alarm: true, basis: "verdaechtig" },
    // Strenger als „trägt etwas“: Ein starkes Gesicht entlastet eine Vermummung nicht, auch nicht bei genau einer Person.
    { fall: "Vermummt, Gesicht erkannt", answer: { handlung: "vermummt", was: "Person mit Sturmhaube" }, face: strong, alarm: true, basis: "ohne_freigabe" },
    { fall: "Vermummt, Gesicht erkannt, nachts", answer: { handlung: "vermummt", was: "Person mit Sturmhaube" }, face: strong, hour: 23, tracked: 1, alarm: true, basis: "ohne_freigabe" },
    { fall: "Vermummt, freigegeben, eine Person", answer: { handlung: "vermummt", was: "Person mit Maske" }, seenAs: "freigegeben", alarm: false, basis: "bekannt" },
    { fall: "Vermummt, freigegeben, Tracker zählt zwei", answer: { handlung: "vermummt", was: "Person mit Maske" }, seenAs: "freigegeben", tracked: 2, alarm: true, basis: "ohne_freigabe" },
    { fall: "Vermummt, tagsüber eingestempelt, eine Person", answer: { handlung: "vermummt", was: "Person mit Maske" }, staff: ["Mitarbeiter A"], hour: 10, alarm: false, basis: "eingestempelt" },
    { fall: "Hund an der Leine, unbekannt, niemand eingestempelt", answer: { handlung: "keine", was: "Person mit Hund an der Leine" }, alarm: true, basis: "niemand" },
    { fall: "Trägt etwas, Sperrliste", answer: { handlung: "traegt_etwas", was: "Person trägt eine Tasche" }, face: { name: "Person B", list: "BLACKLIST", score: 0.7, upscaled: false }, alarm: true, basis: "gesperrt" },
  ];
  for (const c of cases) {
    const seen = c.seenAs ? { bekannt: [1], unbekannt: 0 } : {};
    const l = parsePersonLook(JSON.stringify({ personen: 1, kleidung: ["Person 1: dunkle Jacke"], ...seen, ...c.answer }));
    const ctx: PersonContext = {
      face: c.face ?? null,
      staff: c.staff === undefined ? [] : c.staff,
      look: l,
      hour: c.hour ?? 14,
      known: c.seenAs ? ["Eintrag (Kamera A 10:00)"] : [],
      knownKinds: c.seenAs ? [c.seenAs] : [],
      tracked: c.tracked === undefined ? 1 : c.tracked,
    };
    const d = decidePerson(ctx);
    assert.equal(d.alarm, c.alarm, c.fall);
    assert.equal(d.basis, c.basis, c.fall);
  }
});

test("Kein Alarm bei einer Handlung: der Grund nennt sie", () => {
  const d = decidePerson({
    face: { name: "Person A", list: "WHITELIST", score: 0.66, upscaled: false },
    staff: [],
    look: look({ handlung: "traegt_etwas" }),
    hour: 14,
    tracked: 1,
  });
  assert.equal(d.alarm, false);
  assert.match(d.reason, /trägt etwas/);
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

test("Starkes Gesicht auf der Whitelist reicht, Blacklist und harte Handlung immer Alarm", () => {
  const strong = { name: "Person A", list: "WHITELIST", score: 0.66, upscaled: false };
  const staff = ["Mitarbeiter A"];
  assert.equal(decidePerson({ face: strong, staff: [], look: null, hour: 2, tracked: 1 }).alarm, false);
  // Ereignis eines aelteren Stands (ohne Score und „hochgerechnet“): schwach, allein kein Entwarnen.
  assert.equal(decidePerson({ face: { name: "Person A", list: "WHITELIST" }, staff: [], look: null, hour: 2, tracked: 1 }).alarm, true);
  assert.equal(decidePerson({ face: { name: "Person B", list: "BLACKLIST" }, staff, look: look(), hour: 14 }).alarm, true);
  // Altes Antwortformat („verdaechtig“: ja) gilt weiter als harte Handlung.
  assert.equal(decidePerson({ face: strong, staff, look: look({ handlung: "verdaechtig" }), hour: 14, tracked: 1 }).alarm, true);
  for (const handlung of ["klettern", "tuer_fenster_schloss", "versteckt", "unklar"] as const) {
    const d = decidePerson({ face: { ...strong, score: 0.8 }, staff, look: look({ handlung }), hour: 14, tracked: 1 });
    assert.equal(d.alarm, true, handlung);
    assert.equal(d.basis, "verdaechtig", handlung);
  }
});

test("Niemand eingestempelt oder keine Daten: Alarm", () => {
  assert.equal(decidePerson({ face: null, staff: [], look: look({ mitarbeiter: true }), hour: 14 }).alarm, true);
  assert.equal(decidePerson({ face: null, staff: null, look: look(), hour: 14 }).alarm, true);
});

test("Wiedererkennung über Kameras: alle bekannt → kein Alarm, ein Neuer → Alarm", () => {
  const known = ["Jakob (Übungslift 14:30)", "Zar (Übungslift 14:30)"];
  const l = parsePersonLook('{"personen":2,"kleidung":["blaue Jacke","rote Mütze"],"bekannt":[1,2],"unbekannt":0,"was":"Zwei Personen"}');
  assert.deepEqual(l.bekannt, [1, 2]);
  const d = decidePerson({ face: null, staff: null, look: l, hour: 23, known });
  assert.equal(d.alarm, false);
  assert.match(d.reason, /Jakob.*Zar/);
  const l2 = parsePersonLook('{"personen":3,"bekannt":[1,2],"was":""}');
  assert.equal(l2.unbekannt, 1);
  assert.equal(decidePerson({ face: null, staff: null, look: l2, hour: 23, known }).alarm, true);
  // Nummer ausserhalb der Liste zählt nicht.
  assert.equal(decidePerson({ face: null, staff: null, look: { ...l, bekannt: [5] }, hour: 23, known }).alarm, true);
});

test("Keine Person auf der Nahaufnahme oder ohne Stempeldaten tagsüber bei der Arbeit: kein Alarm", () => {
  assert.equal(decidePerson({ face: null, staff: null, look: look({ personen: 0 }), hour: 14 }).alarm, false);
  assert.equal(decidePerson({ face: null, staff: null, look: look({ mitarbeiter: true }), hour: 14 }).alarm, false);
  assert.equal(decidePerson({ face: null, staff: null, look: look({ mitarbeiter: true }), hour: 23 }).alarm, true);
  assert.equal(decidePerson({ face: null, staff: [], look: look({ mitarbeiter: true }), hour: 14 }).alarm, true);
});
