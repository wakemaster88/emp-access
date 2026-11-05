import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_COOLDOWN_MS,
  DEFAULT_SPOTS,
  camerasForSpot,
  effectivePerHour,
  inHours,
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
