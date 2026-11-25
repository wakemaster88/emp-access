import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_COOLDOWN_MS,
  DEFAULT_SPOTS,
  alertAction,
  alertMode,
  camerasForSpot,
  dayStartLine,
  effectivePerHour,
  inHours,
  spotClosed,
  levelFor,
  mergeSpots,
  newAlertState,
  smooth,
  spotLine,
  stepAlert,
  waitMinutes,
} from "./occupancy-rules.js";

const cams = [
  { id: 2, name: "Kamera Gastro" },
  { id: 4, name: "Kamera Seilbahn B" },
  { id: 5, name: "Kamera Übungslift" },
  { id: 6, name: "Kamera Seilbahn A" },
  { id: 10, name: "Kamera Drehkreuz" },
  { id: 11, name: "DoorBird Eingang", kind: "DOORBIRD" },
  { id: 12, name: "Kamera Imbisscontainer" },
];

test("Kameras werden den Punkten per Namen zugeordnet", () => {
  const by = (key: string) => camerasForSpot(DEFAULT_SPOTS.find((s) => s.key === key)!, cams).map((c) => c.id);
  assert.deepEqual(by("uebungslift"), [5]);
  assert.deepEqual(by("seilbahn-a"), [6]);
  assert.deepEqual(by("seilbahn-b"), [4]);
  assert.deepEqual(by("gastro"), [2, 12]);
  assert.deepEqual(by("drehkreuz"), [10]);
});

test("Median glaettet Ausreisser", () => {
  assert.equal(smooth([2, 30, 3]), 3);
  assert.equal(smooth([10, 12]), 11);
  assert.equal(smooth([]), 0);
});

test("Wartezeit aus Personen und Durchsatz, gemessen nur bei Betrieb", () => {
  const lift = DEFAULT_SPOTS.find((s) => s.key === "seilbahn-a")!;
  assert.deepEqual(effectivePerHour(lift, 5), { perHour: 100, measured: false });
  assert.deepEqual(effectivePerHour(lift, 80), { perHour: 80, measured: true });
  assert.equal(waitMinutes(20, 80), 15);
  assert.equal(waitMinutes(0, 80), 0);
});

test("Stufen", () => {
  assert.equal(levelFor(0, 10), "leer");
  assert.equal(levelFor(3, 10), "ruhig");
  assert.equal(levelFor(6, 10), "gut besucht");
  assert.equal(levelFor(10, 10), "voll");
});

test("Meldung nach zwei vollen Messungen, entspannt erst deutlich darunter", () => {
  const st = newAlertState();
  const m = (persons: number, wait = 0) => ({ persons, full: 10, wait, waitAlertMin: 15 });
  assert.equal(stepAlert(st, m(12), 0), null);
  assert.equal(stepAlert(st, m(12), 300_000), "alert");
  assert.equal(stepAlert(st, m(13), 600_000), null);
  assert.equal(stepAlert(st, m(8), 900_000), null);
  assert.equal(stepAlert(st, m(5), 1_200_000), "relaxed");
  // Gleich wieder voll: Abklingzeit seit der letzten Meldung
  stepAlert(st, m(12), 1_500_000);
  assert.equal(stepAlert(st, m(12), 1_800_000), null);
  stepAlert(st, m(2), 1_900_000);
  stepAlert(st, m(12), 300_000 + ALERT_COOLDOWN_MS);
  assert.equal(stepAlert(st, m(12), 600_000 + ALERT_COOLDOWN_MS), "alert");
});

test("Lange Wartezeit meldet auch unter der Personen-Schwelle", () => {
  const st = newAlertState();
  stepAlert(st, { persons: 8, full: 10, wait: 20, waitAlertMin: 15 }, 0);
  assert.equal(stepAlert(st, { persons: 8, full: 10, wait: 20, waitAlertMin: 15 }, 300_000), "alert");
});

test("Eigene Einstellungen ueberschreiben Vorgaben, ungueltiges bleibt Vorgabe", () => {
  const s = mergeSpots(DEFAULT_SPOTS, {
    spots: [
      { key: "uebungslift", full: 8, perHour: -3, zones: { "5": [[0, 0.5], [1, 0.5], [1, 1], [0, 1]] } },
      { key: "gastro", cameras: "([" },
      { key: "shop", name: "Shop", cameras: "shop", full: 6 },
      { key: "seilbahn-b", enabled: false },
    ],
  });
  const lift = s.find((x) => x.key === "uebungslift")!;
  assert.equal(lift.full, 8);
  assert.equal(lift.perHour, 60);
  assert.equal(lift.zones?.["5"].length, 4);
  assert.equal(s.find((x) => x.key === "gastro")!.cameras, "gastro|imbiss");
  assert.equal(s.find((x) => x.key === "shop")!.full, 6);
  assert.equal(s.find((x) => x.key === "seilbahn-b")!.enabled, false);
  assert.equal(DEFAULT_SPOTS.find((x) => x.key === "uebungslift")!.full, 12);
});

test("Betriebszeit und Textzeile", () => {
  assert.equal(inHours("9-21", 8), false);
  assert.equal(inHours("9-21", 9), true);
  assert.equal(inHours("9-21", 21), false);
  assert.equal(inHours("", 3), true);
  assert.equal(
    spotLine({ name: "Übungslift", persons: 14, level: "voll", wait: 14 }),
    "Übungslift: voll (14 Personen, Wartezeit ca. 14 min)",
  );
});

test("Betriebszeit: ohne endliche Stunde wird nicht gemessen, auch nicht bei „immer“", () => {
  assert.equal(inHours("9-21", NaN), false);
  assert.equal(inHours("9-21", Infinity), false);
  assert.equal(inHours("21-9", -Infinity), false);
  assert.equal(inHours("", NaN), false);
  assert.equal(inHours("7-7", NaN), false);
  // Mit Stunde gilt „immer“ wie zuvor.
  assert.equal(inHours("7-7", 3), true);
  assert.equal(inHours("21-9", 23), true);
  assert.equal(inHours("21-9", 12), false);
});

test("Punkt ruht, wenn alle Raeume seiner Kameras zu sind", () => {
  const rooms = [
    { cameras: [{ id: 5 }], operating: { open: false } },
    { cameras: [{ id: 7 }], operating: { open: true } },
    { cameras: [{ id: 8 }], operating: null },
  ];
  assert.equal(spotClosed([5], rooms), true);
  assert.equal(spotClosed([5, 7], rooms), false);
  // Raum ohne Betriebszeit oder Kamera ohne Raum: weiter messen.
  assert.equal(spotClosed([8], rooms), false);
  assert.equal(spotClosed([9], rooms), false);
  assert.equal(spotClosed([], rooms), false);
});

test("Meldungen: on, off und der Probelauf als Standard", () => {
  for (const v of ["on", "1", "true", "ja", "an", "yes", " ON ", "True", "JA"]) {
    assert.deepEqual(alertMode(v), { mode: "on", known: true }, v);
  }
  for (const v of ["off", "0", "false", "nein", "aus", "no", " Off ", "FALSE"]) {
    assert.deepEqual(alertMode(v), { mode: "off", known: true }, v);
  }
  // Fehlt die Variable oder ist sie leer: Probelauf.
  assert.deepEqual(alertMode(undefined), { mode: "shadow", known: true });
  assert.deepEqual(alertMode(null), { mode: "shadow", known: true });
  assert.deepEqual(alertMode(""), { mode: "shadow", known: true });
  assert.deepEqual(alertMode("   "), { mode: "shadow", known: true });
  assert.deepEqual(alertMode("shadow"), { mode: "shadow", known: true });
  assert.deepEqual(alertMode(" Shadow "), { mode: "shadow", known: true });
});

test("Meldungen: ein unbekannter Wert schaltet nichts ein", () => {
  for (const v of ["vielleicht", "2", "on!", "o n", "-1", "onoff"]) {
    assert.deepEqual(alertMode(v), { mode: "shadow", known: false }, v);
  }
});

test("Meldungen: gesendet wird nur bei on, der Probelauf loggt, off wertet nichts aus", () => {
  assert.equal(alertAction("on", "alert"), "send");
  assert.equal(alertAction("on", "relaxed"), "send");
  assert.equal(alertAction("shadow", "alert"), "log");
  assert.equal(alertAction("shadow", "relaxed"), "log");
  assert.equal(alertAction("off", "alert"), null);
  assert.equal(alertAction("off", "relaxed"), null);
  for (const mode of ["on", "off", "shadow"] as const) assert.equal(alertAction(mode, null), null);
  // Fehlt die Variable, kommt aus keiner Messung eine Nachricht.
  const st = newAlertState();
  const m = (persons: number) => ({ persons, full: 10, wait: 0, waitAlertMin: 15 });
  const actions = [12, 12, 13, 5].map((persons, i) => alertAction(alertMode(undefined).mode, stepAlert(st, m(persons), i * 300_000)));
  assert.deepEqual(actions, [null, "log", null, "log"]);
});

const reading = (persons: number, cams: Array<number | null>) => ({ persons, cameras: cams.map((p) => ({ persons: p })) });

test("Erste Messung des Tages: Zahl der Bereiche und Summe der Personen", () => {
  assert.equal(
    dayStartLine([reading(3, [3]), reading(4, [1, 3]), reading(0, [0])], 0),
    "Belegung: erste Messung heute: 3 Bereiche, 7 Personen",
  );
  assert.equal(dayStartLine([reading(1, [1])], 0), "Belegung: erste Messung heute: 1 Bereich, 1 Person");
});

test("Erste Messung des Tages: ruhende Bereiche und Bereiche ohne Kamerabild stehen dabei", () => {
  assert.equal(
    dayStartLine([reading(2, [2])], 4),
    "Belegung: erste Messung heute: 1 Bereich, 2 Personen (4 Bereiche ruhen, Räume geschlossen)",
  );
  assert.equal(
    dayStartLine([], 5),
    "Belegung: erste Messung heute: 0 Bereiche, 0 Personen (5 Bereiche ruhen, Räume geschlossen)",
  );
  // Keine Kamera hat geliefert: Der Bereich zaehlt nicht als gemessen, seine 0 nicht als Messwert.
  assert.equal(
    dayStartLine([reading(5, [5, null]), reading(0, [null, null])], 1),
    "Belegung: erste Messung heute: 1 Bereich, 5 Personen (1 Bereich ruht, Räume geschlossen; 1 Bereich ohne Kamerabild)",
  );
  // Bereich ohne Kamera (nur Drehkreuz) zaehlt als gemessen.
  assert.equal(dayStartLine([reading(0, [])], 0), "Belegung: erste Messung heute: 1 Bereich, 0 Personen");
});

test("Erste Messung des Tages: nach einem Neustart im Lauf des Tages heisst sie Fortsetzung", () => {
  assert.equal(dayStartLine([reading(3, [3])], 0, true), "Belegung: Messung heute fortgesetzt: 1 Bereich, 3 Personen");
});
