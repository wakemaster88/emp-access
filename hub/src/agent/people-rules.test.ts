import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLEAR_MS,
  MAX_CLEARED,
  REPORTED_LABEL,
  REPORTED_MS,
  STAFF_LABEL,
  afterAlarm,
  afterNoAlarm,
  afterOk,
  grantFor,
  kindFromLabel,
  knownUsable,
  pruneCleared,
  reviveEntry,
  reviveStore,
  singlePerson,
  type ClearedPerson,
  type Sighting,
} from "./people-rules.js";
import { decidePerson, parsePersonLook } from "./sentinel-rules.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 15, 21, 0); // 22:00 Ortszeit
const FACE = "Testname";

const counter = () => {
  let n = 0;
  return () => `neu${++n}`;
};

const entry = (o: Partial<ClearedPerson> = {}): ClearedPerson => {
  const kind = o.kind ?? "freigegeben";
  const at = o.at ?? T0;
  return {
    id: "a1",
    kind,
    label: kind === "gemeldet" ? REPORTED_LABEL : kind === "mitarbeiter" ? STAFF_LABEL : "freigegeben",
    kleidung: "Person 1: dunkle Jacke, Jeans, Rucksack",
    camera: "Kamera Umkleide",
    at,
    until: at + (kind === "gemeldet" ? REPORTED_MS : CLEAR_MS),
    ...o,
  };
};

const seen = (o: Partial<Sighting> = {}): Sighting => ({
  now: T0 + 10 * MIN,
  camera: "Kamera Shop",
  basis: "bekannt",
  faceName: null,
  persons: 1,
  tracked: 1,
  unknown: 0,
  kleidung: ["Person 1: dunkle Jacke, Jeans"],
  matchedIds: ["a1"],
  ...o,
});

test("Art aus dem Label: gemeldet, Mitarbeiter, alles andere freigegeben", () => {
  assert.equal(kindFromLabel("bereits gemeldet"), "gemeldet");
  assert.equal(kindFromLabel("Mitarbeiter"), "mitarbeiter");
  assert.equal(kindFromLabel(" Mitarbeiter "), "mitarbeiter");
  for (const label of [FACE, "unbedenklich", "per Knopf freigegeben", "", "mitarbeiter am Tor", "Bereits gemeldet"]) {
    assert.equal(kindFromLabel(label), "freigegeben", label);
  }
});

test("Eintrag ohne Art aus der Datei wird zugeordnet, eine vorhandene Art bleibt", () => {
  const raw = { id: "a1", kleidung: "rote Jacke", camera: "Kamera Shop", at: T0, until: T0 + 5 * MIN };
  assert.equal(reviveEntry({ ...raw, label: "bereits gemeldet" }, T0)?.kind, "gemeldet");
  assert.equal(reviveEntry({ ...raw, label: "Mitarbeiter" }, T0)?.kind, "mitarbeiter");
  assert.equal(reviveEntry({ ...raw, label: FACE }, T0)?.kind, "freigegeben");
  // Die gespeicherte Art gilt, auch wenn das Label anders klingt.
  assert.equal(reviveEntry({ ...raw, label: "Mitarbeiter", kind: "freigegeben" }, T0)?.kind, "freigegeben");
  assert.equal(reviveEntry({ ...raw, label: FACE, kind: "gemeldet" }, T0)?.kind, "gemeldet");
  // Unbekannte Art: wie ohne Feld.
  assert.equal(reviveEntry({ ...raw, label: "bereits gemeldet", kind: "sonstwas" }, T0)?.kind, "gemeldet");
  assert.deepEqual(reviveEntry({ ...raw, label: FACE }, T0), { ...raw, label: FACE, kind: "freigegeben" });
});

test("Kein Eintrag aus der Datei gilt laenger, als seine Art erlaubt", () => {
  const raw = { id: "a1", label: "bereits gemeldet", kleidung: "rote Jacke", camera: "Kamera Shop", at: T0 };
  // Gemeldet: hoechstens 20 Minuten ab dem Zeitpunkt im Eintrag.
  assert.equal(reviveEntry({ ...raw, until: T0 + CLEAR_MS }, T0 + MIN)?.until, T0 + REPORTED_MS);
  assert.equal(reviveEntry({ ...raw, until: T0 + 5 * MIN }, T0 + MIN)?.until, T0 + 5 * MIN);
  // Freigegeben und Mitarbeiter: hoechstens 8 Stunden.
  assert.equal(reviveEntry({ ...raw, label: FACE, until: T0 + 3 * CLEAR_MS }, T0 + MIN)?.until, T0 + CLEAR_MS);
  assert.equal(reviveEntry({ ...raw, label: "Mitarbeiter", until: T0 + 3 * CLEAR_MS }, T0 + MIN)?.until, T0 + CLEAR_MS);
  // Zeitpunkt in der Zukunft: zaehlt ab jetzt.
  const future = reviveEntry({ ...raw, label: FACE, at: T0 + 100 * CLEAR_MS, until: T0 + 101 * CLEAR_MS }, T0);
  assert.equal(future?.at, T0);
  assert.equal(future?.until, T0 + CLEAR_MS);
});

test("Unvollstaendige Eintraege werden nicht uebernommen", () => {
  const ok = { id: "a1", label: FACE, kleidung: "rote Jacke", camera: "Kamera Shop", at: T0, until: T0 + MIN };
  assert.ok(reviveEntry(ok, T0));
  for (const bad of [
    null,
    "text",
    [],
    { ...ok, id: "" },
    { ...ok, id: 7 },
    { ...ok, label: null },
    { ...ok, kleidung: ["rote Jacke"] },
    { ...ok, camera: undefined },
    { ...ok, at: "gestern" },
    { ...ok, until: NaN },
    { ...ok, until: Infinity },
  ]) {
    assert.equal(reviveEntry(bad, T0), null, JSON.stringify(bad));
  }
});

test("Dateiinhalt: Eintraege und offene Knoepfe, Unlesbares wird gezaehlt", () => {
  const raw = {
    cleared: [
      { id: "a1", label: "bereits gemeldet", kleidung: "rote Jacke", camera: "Kamera Shop", at: T0, until: T0 + CLEAR_MS },
      { id: "a2", label: "Mitarbeiter", kleidung: "Warnweste", camera: "Kamera Shop", at: T0, until: T0 + CLEAR_MS },
      { id: "a3", kleidung: "ohne Label" },
    ],
    pending: [
      ["tok1", { camera: "Kamera Shop", kleidung: ["rote Jacke"], at: T0 }],
      ["tok2", { camera: "Kamera Shop", kleidung: "rote Jacke", at: T0 }],
      "kaputt",
    ],
  };
  const r = reviveStore(raw, T0 + MIN);
  assert.ok(r);
  assert.deepEqual(r.store.cleared.map((c) => [c.id, c.kind, c.until - T0]), [
    ["a1", "gemeldet", REPORTED_MS],
    ["a2", "mitarbeiter", CLEAR_MS],
  ]);
  assert.deepEqual(r.store.pending, [["tok1", { camera: "Kamera Shop", kleidung: ["rote Jacke"], at: T0 }]]);
  assert.equal(r.dropped, 3);
  // Leeres Objekt ist ein gueltiger, leerer Stand; alles andere nicht.
  assert.deepEqual(reviveStore({}, T0), { store: { cleared: [], pending: [] }, dropped: 0 });
  for (const bad of [null, [], "text", 5]) assert.equal(reviveStore(bad, T0), null);
});

test("Aufraeumen: Abgelaufenes faellt weg, bei mehr als 30 bleiben die juengsten", () => {
  const list = [entry({ id: "alt", until: T0 - 1 }), entry({ id: "genau", until: T0 }), entry({ id: "gilt", until: T0 + 1 })];
  assert.deepEqual(pruneCleared(list, T0).map((c) => c.id), ["gilt"]);
  const many = Array.from({ length: MAX_CLEARED + 5 }, (_, i) => entry({ id: `e${i}` }));
  const kept = pruneCleared(many, T0);
  assert.equal(kept.length, MAX_CLEARED);
  assert.equal(kept[0].id, "e5");
  assert.equal(kept.at(-1)?.id, `e${MAX_CLEARED + 4}`);
});

test("Mitarbeiter-Eintraege zaehlen im Nachtfenster nicht als bekannt", () => {
  const staff = entry({ kind: "mitarbeiter" });
  const usable = (hour: number, night = "22-6") => knownUsable(staff, hour, night);
  assert.equal(usable(23), false);
  assert.equal(usable(22), false);
  assert.equal(usable(0), false);
  assert.equal(usable(5), false);
  assert.equal(usable(6), true);
  assert.equal(usable(12), true);
  assert.equal(usable(21), true);
  // Anderes Nachtfenster aus HUB_AGENT_SENTINEL_NIGHT.
  assert.equal(usable(20, "20-7"), false);
  assert.equal(usable(6, "20-7"), false);
  assert.equal(usable(7, "20-7"), true);
  // Kein gueltiges Fenster: Es gibt keine Nacht.
  assert.equal(usable(23, ""), true);
  assert.equal(usable(23, "aus"), true);
  // Ohne lesbare Stunde zaehlt der Eintrag nicht.
  assert.equal(usable(NaN), false);
  assert.equal(usable(Infinity), false);
  // Freigegebene und gemeldete Eintraege zaehlen zu jeder Stunde.
  for (const kind of ["freigegeben", "gemeldet"] as const) {
    for (const hour of [0, 3, 12, 23, NaN]) assert.equal(knownUsable(entry({ kind }), hour, "22-6"), true, `${kind} ${hour}`);
  }
});

test("Genau eine Person: Nahaufnahme, Beschreibungen und Tracker muessen dazu passen", () => {
  assert.equal(singlePerson({ persons: 1, tracked: 1, kleidung: ["a"] }), true);
  assert.equal(singlePerson({ persons: 1, tracked: null, kleidung: ["a"] }), true);
  assert.equal(singlePerson({ persons: 1, kleidung: [] }), true);
  assert.equal(singlePerson({ persons: 1, tracked: 0, kleidung: ["a"] }), true);
  assert.equal(singlePerson({ persons: 2, tracked: 1, kleidung: ["a"] }), false);
  assert.equal(singlePerson({ persons: 1, tracked: 2, kleidung: ["a"] }), false);
  assert.equal(singlePerson({ persons: 1, tracked: 1, kleidung: ["a", "b"] }), false);
  assert.equal(singlePerson({ persons: 0, tracked: 1, kleidung: [] }), false);
  assert.equal(singlePerson({ persons: null, tracked: 1, kleidung: ["a"] }), false);
});

test("Was sich die Liste nach „kein Alarm“ merkt, haengt am Grund", () => {
  assert.deepEqual(grantFor("gesicht", FACE), { kind: "freigegeben", label: FACE });
  assert.deepEqual(grantFor("gesicht", "  "), { kind: "freigegeben", label: "Gesicht erkannt" });
  assert.deepEqual(grantFor("eingestempelt"), { kind: "mitarbeiter", label: "Mitarbeiter" });
  assert.deepEqual(grantFor("arbeit"), { kind: "mitarbeiter", label: "Mitarbeiter" });
  assert.equal(grantFor("bekannt", FACE), null);
  assert.equal(grantFor("leer", FACE), null);
});

test("Gemeldeter Eintrag wird beim Wiedersehen nie verlaengert", () => {
  const list = [entry({ kind: "gemeldet" })];
  // Wiedersehen nach 10 Minuten, egal aus welchem Grund es keinen Alarm gab.
  for (const s of [
    seen(),
    seen({ basis: "arbeit" }),
    seen({ basis: "gesicht", faceName: FACE, persons: 3, unknown: 2, kleidung: ["a", "b", "c"] }),
    seen({ basis: "eingestempelt", persons: 2, unknown: 1, kleidung: ["a", "b"] }),
    seen({ basis: "leer", persons: 0 }),
  ]) {
    const r = afterNoAlarm(list, s, counter());
    assert.deepEqual(r.entries[0], list[0], s.basis);
    assert.equal(r.extended, 0);
    assert.equal(r.promoted, 0);
    assert.equal(r.added, 0);
  }
  // 20 Minuten nach dem Alarm ist der Eintrag abgelaufen, auch nach mehreren Sichtungen.
  let cur = list;
  for (const min of [5, 10, 15, 19]) cur = afterNoAlarm(cur, seen({ now: T0 + min * MIN }), counter()).entries;
  assert.equal(cur[0].until, T0 + REPORTED_MS);
  assert.equal(cur[0].at, T0);
  assert.equal(cur[0].camera, "Kamera Umkleide");
  assert.deepEqual(pruneCleared(cur, T0 + 20 * MIN - 1).length, 1);
  assert.deepEqual(pruneCleared(cur, T0 + 20 * MIN), []);
});

test("Freigegebene Eintraege und Mitarbeiter-Eintraege gelten ab dem Wiedersehen wieder 8 Stunden", () => {
  for (const kind of ["freigegeben", "mitarbeiter"] as const) {
    const before = entry({ kind });
    const r = afterNoAlarm([before], seen(), counter());
    assert.equal(r.extended, 1);
    assert.deepEqual(r.entries[0], { ...before, at: T0 + 10 * MIN, camera: "Kamera Shop", until: T0 + 10 * MIN + CLEAR_MS });
  }
  // Nicht wiedererkannte Eintraege bleiben unberuehrt, die Eingabe auch.
  const list = [entry(), entry({ id: "a2" })];
  const copy = structuredClone(list);
  const r = afterNoAlarm(list, seen(), counter());
  assert.deepEqual(r.entries[1], list[1]);
  assert.deepEqual(list, copy);
  // Auch bei mehreren Personen im Bild wird ein wiedererkannter Eintrag verlaengert.
  const group = afterNoAlarm([entry()], seen({ basis: "eingestempelt", persons: 2, unknown: 1, kleidung: ["a", "b"] }), counter());
  assert.equal(group.extended, 1);
  assert.equal(group.entries[0].until, T0 + 10 * MIN + CLEAR_MS);
});

test("Gemeldeter Eintrag wird freigegeben: Gesichts-Treffer und genau eine Person", () => {
  const r = afterNoAlarm([entry({ kind: "gemeldet" })], seen({ basis: "gesicht", faceName: FACE }), counter());
  assert.equal(r.promoted, 1);
  assert.deepEqual(r.entries[0], {
    ...entry({ kind: "gemeldet" }),
    kind: "freigegeben",
    label: FACE,
    at: T0 + 10 * MIN,
    camera: "Kamera Shop",
    until: T0 + 10 * MIN + CLEAR_MS,
  });
});

test("Gemeldeter Eintrag bei eingestempeltem Personal und genau einer Person: Mitarbeiter-Eintrag", () => {
  const r = afterNoAlarm([entry({ kind: "gemeldet" })], seen({ basis: "eingestempelt", unknown: 1 }), counter());
  assert.equal(r.promoted, 1);
  assert.equal(r.entries[0].kind, "mitarbeiter");
  assert.equal(r.entries[0].label, "Mitarbeiter");
  assert.equal(r.entries[0].until, T0 + 10 * MIN + CLEAR_MS);
  // Der Eintrag zaehlt damit tagsueber, im Nachtfenster nicht.
  assert.equal(knownUsable(r.entries[0], 14, "22-6"), true);
  assert.equal(knownUsable(r.entries[0], 23, "22-6"), false);
});

test("Gemeldeter Eintrag bleibt gemeldet, wenn die Bedingungen nicht alle erfuellt sind", () => {
  const reported = [entry({ kind: "gemeldet" })];
  const stays = (s: Sighting) => {
    const r = afterNoAlarm(reported, s, counter());
    assert.equal(r.promoted, 0);
    assert.equal(r.entries[0].kind, "gemeldet");
    assert.equal(r.entries[0].until, T0 + REPORTED_MS);
  };
  // Mehrere Personen im Bild.
  stays(seen({ basis: "gesicht", faceName: FACE, persons: 2, unknown: 1, kleidung: ["a", "b"] }));
  stays(seen({ basis: "eingestempelt", persons: 3, unknown: 2, kleidung: ["a", "b", "c"] }));
  // Der Tracker hat auf dem Uebersichtsbild mehr Personen gefunden als die Nahaufnahme zeigt.
  stays(seen({ basis: "gesicht", faceName: FACE, tracked: 2 }));
  // Eine Person gezaehlt, aber zwei beschrieben.
  stays(seen({ basis: "gesicht", faceName: FACE, kleidung: ["a", "b"] }));
  // Anderer Grund: nur schon gesehen, oder Arbeit am Tag ohne Stempeldaten.
  stays(seen({ basis: "bekannt" }));
  stays(seen({ basis: "arbeit", unknown: 1 }));
  // Ohne Bewertung der Nahaufnahme ist die Zahl der Personen offen.
  stays(seen({ basis: "gesicht", faceName: FACE, persons: null, kleidung: [] }));
  // Der Eintrag wurde nicht wiedererkannt.
  stays(seen({ basis: "gesicht", faceName: FACE, matchedIds: [] }));
});

test("Neue Beschreibung nur bei genau einer Person, unter dem Namen bzw. als Mitarbeiter", () => {
  const one = (basis: Sighting["basis"]) =>
    afterNoAlarm([], seen({ basis, faceName: FACE, unknown: 1, matchedIds: [], kleidung: ["Person 1: gelbe Warnweste"] }), counter());
  const face = one("gesicht");
  assert.equal(face.added, 1);
  assert.deepEqual(face.entries, [
    {
      id: "neu1",
      kind: "freigegeben",
      label: FACE,
      kleidung: "Person 1: gelbe Warnweste",
      camera: "Kamera Shop",
      at: T0 + 10 * MIN,
      until: T0 + 10 * MIN + CLEAR_MS,
    },
  ]);
  for (const basis of ["eingestempelt", "arbeit"] as const) {
    const r = one(basis);
    assert.equal(r.added, 1);
    assert.equal(r.entries[0].kind, "mitarbeiter");
    assert.equal(r.entries[0].label, "Mitarbeiter");
  }
});

test("Mehrere Personen im Bild: keine Beschreibung unter dem Namen des Treffers oder als Mitarbeiter", () => {
  const three = ["Person 1: rote Jacke", "Person 2: blaue Jacke", "Person 3: grüner Pullover"];
  for (const basis of ["gesicht", "eingestempelt", "arbeit"] as const) {
    const r = afterNoAlarm([], seen({ basis, faceName: FACE, persons: 3, tracked: 3, unknown: 3, kleidung: three, matchedIds: [] }), counter());
    assert.deepEqual(r.entries, [], basis);
    assert.equal(r.added, 0);
    assert.equal(r.withheld, 3);
  }
  // Zwei Personen laut Tracker, eine auf der Nahaufnahme: ebenfalls nichts.
  const zoomed = afterNoAlarm([], seen({ basis: "gesicht", faceName: FACE, tracked: 2, unknown: 1, matchedIds: [] }), counter());
  assert.deepEqual(zoomed.entries, []);
  assert.equal(zoomed.withheld, 1);
});

test("Nichts Neues, wenn alle bekannt sind oder niemand im Bild ist", () => {
  // Alle bekannt: keine Person ohne Eintrag.
  const known = afterNoAlarm([entry()], seen({ basis: "bekannt", unknown: 0 }), counter());
  assert.equal(known.entries.length, 1);
  assert.equal(known.added, 0);
  assert.equal(known.withheld, 0);
  // Gesichts-Treffer, die Person steht schon auf der Liste.
  const again = afterNoAlarm([entry()], seen({ basis: "gesicht", faceName: FACE, unknown: 0 }), counter());
  assert.equal(again.entries.length, 1);
  assert.equal(again.extended, 1);
  // Niemand im Bild: Die Liste bleibt, wie sie ist.
  const list = [entry(), entry({ id: "a2", kind: "mitarbeiter" })];
  const empty = afterNoAlarm(list, seen({ basis: "leer", persons: 0, unknown: 1, kleidung: ["Person 1: unklar"], matchedIds: ["a1", "a2"] }), counter());
  assert.deepEqual(empty.entries, list);
  assert.deepEqual([empty.extended, empty.promoted, empty.added, empty.withheld], [0, 0, 0, 0]);
});

test("Nach einem Alarm: gemeldet fuer 20 Minuten", () => {
  const list = afterAlarm([entry()], { now: T0, camera: "Kamera Umkleide", kleidung: ["Person 1: Kapuzenjacke", "Person 2: helle Jacke"] }, counter());
  assert.equal(list.length, 3);
  assert.deepEqual(list.slice(1), [
    { id: "neu1", kind: "gemeldet", label: "bereits gemeldet", kleidung: "Person 1: Kapuzenjacke", camera: "Kamera Umkleide", at: T0, until: T0 + REPORTED_MS },
    { id: "neu2", kind: "gemeldet", label: "bereits gemeldet", kleidung: "Person 2: helle Jacke", camera: "Kamera Umkleide", at: T0, until: T0 + REPORTED_MS },
  ]);
  assert.equal(REPORTED_MS, 20 * MIN);
});

test("Knopf „Ist in Ordnung“: freigegeben fuer 8 Stunden, auch im Nachtfenster", () => {
  const list = afterOk([], { now: T0, camera: "Kamera Umkleide", kleidung: ["Person 1: Kapuzenjacke"], label: "per Knopf freigegeben" }, counter());
  assert.deepEqual(list, [
    { id: "neu1", kind: "freigegeben", label: "per Knopf freigegeben", kleidung: "Person 1: Kapuzenjacke", camera: "Kamera Umkleide", at: T0, until: T0 + CLEAR_MS },
  ]);
  assert.equal(CLEAR_MS, 8 * 60 * MIN);
  assert.equal(knownUsable(list[0], 23, "22-6"), true);
});

test("Ablauf: Alarm, Wiedersehen ohne Alarm, nach 20 Minuten wieder Alarm", () => {
  const active = (list: ClearedPerson[], now: number) => list.filter((c) => c.until > now);
  const titles = (list: ClearedPerson[]) => list.map((c) => c.label);
  const decide = (list: ClearedPerson[], now: number, hour: number) => {
    const known = active(list, now).filter((c) => knownUsable(c, hour, "22-6"));
    // Das Bildmodell erkennt die Person wieder, solange ihr Eintrag in der Liste steht.
    const look = parsePersonLook(JSON.stringify({ personen: 1, kleidung: ["Person 1: Kapuzenjacke"], bekannt: known.length ? [1] : [], unbekannt: known.length ? 0 : 1 }));
    return { known, look, decision: decidePerson({ face: null, staff: [], look, hour, known: titles(known) }) };
  };
  let list: ClearedPerson[] = [];
  // 22:00 Alarm, die Person wird gemerkt.
  const first = decide(list, T0, 22);
  assert.equal(first.decision.alarm, true);
  list = afterAlarm(list, { now: T0, camera: "Kamera Umkleide", kleidung: first.look.kleidung }, counter());
  // 22:17 an der naechsten Kamera: schon gemeldet, kein neuer Alarm, die Frist bleibt.
  const second = decide(list, T0 + 17 * MIN, 22);
  assert.equal(second.decision.alarm, false);
  assert.equal(second.decision.basis, "bekannt");
  list = afterNoAlarm(list, { now: T0 + 17 * MIN, camera: "Kamera Shop", basis: "bekannt", persons: 1, unknown: 0, kleidung: second.look.kleidung, matchedIds: second.known.map((c) => c.id) }, counter()).entries;
  assert.equal(list[0].until, T0 + REPORTED_MS);
  // 22:21, die Person ist noch da: wieder Alarm.
  const third = decide(list, T0 + 21 * MIN, 22);
  assert.deepEqual(third.known, []);
  assert.equal(third.decision.alarm, true);
});

test("Mitarbeiter-Eintrag vom Tag: nachts entscheidet die Sichtung neu", () => {
  const list = [entry({ kind: "mitarbeiter", at: T0 - 3 * 60 * MIN, until: T0 - 3 * 60 * MIN + CLEAR_MS })];
  const look = (known: number) => parsePersonLook(JSON.stringify({ personen: 1, bekannt: known ? [1] : [], unbekannt: known ? 0 : 1 }));
  // 19 Uhr: Der Eintrag zaehlt, kein Alarm.
  const day = list.filter((c) => knownUsable(c, 19, "22-6"));
  assert.equal(decidePerson({ face: null, staff: [], look: look(day.length), hour: 19, known: day.map((c) => c.label) }).alarm, false);
  // 23 Uhr: Der Eintrag zaehlt nicht, ohne eingestempeltes Personal gibt es Alarm.
  const night = list.filter((c) => knownUsable(c, 23, "22-6"));
  assert.deepEqual(night, []);
  const d = decidePerson({ face: null, staff: [], look: look(night.length), hour: 23, known: [] });
  assert.equal(d.alarm, true);
  assert.equal(d.basis, "niemand");
});
