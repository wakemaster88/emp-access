import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_KEEP_DAYS,
  HINT_MIN_FAILS,
  HINT_MIN_SHARE,
  HINT_STREAK,
  TRAIL_NOPARKING,
  TRAIL_TRACKER,
  addDaily,
  failRateDue,
  hintsFor,
  localDay,
  mergeDaily,
  newTrail,
  parseDaily,
  serializeDaily,
  trackerCalls,
  trailStep,
  type DailyCounts,
} from "./improve-rules.js";

const nopark = (hints: string[]) => hints.filter((h) => h.startsWith("Halteverbot-Prüfung"));
const trackerHint = (hints: string[]) => hints.filter((h) => h.startsWith("YOLO-Tracker"));

test("Standard: Hinweis ab 2 % bei mindestens 5 Fehlern oder bei 3 Fehlern in Folge", () => {
  assert.equal(HINT_MIN_SHARE, 0.02);
  assert.equal(HINT_MIN_FAILS, 5);
  assert.equal(HINT_STREAK, 3);
});

test("Halteverbot: 18 Fehler in 24.000 Durchläufen geben keinen Hinweis, 60 in 1.000 einen", () => {
  assert.deepEqual(nopark(hintsFor({ "noparking.fail": 18, "noparking.run": 24_000 })), []);
  const hints = nopark(hintsFor({ "noparking.fail": 60, "noparking.run": 1_000 }));
  assert.equal(hints.length, 1);
  assert.match(hints[0], /60 von 1\.000 Durchläufen \(6 %\)/);
  assert.doesNotMatch(hints[0], /HUB_NOPARK_CAMERAS/);
});

test("Fehleranteil: unter 5 Fehlern kein Hinweis, auch wenn der Anteil hoch ist", () => {
  assert.equal(failRateDue({ fails: 4, total: 10 }), false);
  assert.equal(failRateDue({ fails: 5, total: 250 }), true);
  assert.equal(failRateDue({ fails: 5, total: 251 }), false);
  // Ohne Zahl der Läufe (älterer Zählerstand) zählen die Fehler als Läufe.
  assert.equal(failRateDue({ fails: 5, total: 0 }), true);
});

test("3 Fehler in Folge: Hinweis mit dem letzten Fehlertext, bis der nächste Lauf gelingt", () => {
  let trail = newTrail();
  trail = trailStep(trail, "Zeitüberschreitung");
  trail = trailStep(trail, "HTTP 401");
  const counts = { "noparking.fail": 2, "noparking.run": 5_000 };
  assert.deepEqual(nopark(hintsFor(counts, { trails: { [TRAIL_NOPARKING]: trail } })), []);
  trail = trailStep(trail, "Kamera antwortet nicht");
  const hints = nopark(hintsFor({ ...counts, "noparking.fail": 3 }, { trails: { [TRAIL_NOPARKING]: trail } }));
  assert.equal(hints.length, 1);
  assert.match(hints[0], /3 in Folge, zuletzt: Kamera antwortet nicht/);
  // Ein gelungener Lauf beendet die Folge; der Text bleibt für den nächsten Hinweis.
  trail = trailStep(trail, null);
  assert.deepEqual(trail, { streak: 0, last: "Kamera antwortet nicht" });
  assert.deepEqual(nopark(hintsFor({ ...counts, "noparking.fail": 3 }, { trails: { [TRAIL_NOPARKING]: trail } })), []);
});

test("Fehlertext wird gekürzt", () => {
  const t = trailStep(newTrail(), "x".repeat(400));
  assert.equal(t.last?.length, 161);
});

test("Tracker: Anteil über alle Aufrufer, ohne Vergleichsaufrufe", () => {
  const counts = {
    "tracker.vehicle.ok": 400,
    "tracker.persons.ok": 500,
    "tracker.noparking.fail": 10,
    "tracker.noparking.ok": 90,
    "tracker.noparking_shadow.fail": 500,
    "tracker.live.off": 30,
  };
  assert.deepEqual(trackerCalls(counts), { ok: 990, fail: 10 });
  assert.deepEqual(trackerHint(hintsFor(counts)), []);
  const hints = trackerHint(
    hintsFor({ ...counts, "tracker.noparking.fail": 30 }, { trails: { [TRAIL_TRACKER]: { streak: 1, last: "HTTP 500" } }, trackerTimeoutSec: 6 }),
  );
  assert.equal(hints.length, 1);
  assert.match(hints[0], /30 von 1\.020 Aufrufen \(2,9 %\), zuletzt: HTTP 500/);
  assert.match(hints[0], /HUB_VISION_TIMEOUT_MS, 6 s/);
});

test("Reihenfolge: Mac zuerst, ohne Auffälliges ein Satz", () => {
  assert.deepEqual(hintsFor({}), ["Keine auffälligen Raten in dieser Session"]);
  const hints = hintsFor({ "task.fail": 2 }, { system: ["Auto-Login fehlt"], nearMiss: "Beinahe-Treffer" });
  assert.deepEqual(hints, ["Auto-Login fehlt", "Beinahe-Treffer", "Tasks fehlgeschlagen: 2 – Queue/API prüfen"]);
});

test("Tagessummen: überstehen Speichern und Laden, neuer Tag beginnt bei null", () => {
  const daily: DailyCounts = {};
  addDaily(daily, "2026-11-25", "noparking.clear", 3);
  addDaily(daily, "2026-11-26", "noparking.clear", 2);
  addDaily(daily, "2026-11-26", "noparking.clear", 1);
  const back = parseDaily(serializeDaily(daily));
  assert.deepEqual(back, { "2026-11-25": { "noparking.clear": 3 }, "2026-11-26": { "noparking.clear": 3 } });
  // Nach dem Neustart: gespeicherte und neu gezählte Werte zusammen.
  const merged = mergeDaily(back, { "2026-11-26": { "noparking.clear": 4, "noparking.fail": 1 } });
  assert.deepEqual(merged["2026-11-26"], { "noparking.clear": 7, "noparking.fail": 1 });
  assert.deepEqual(merged["2026-11-25"], { "noparking.clear": 3 });
});

test("Tagessummen: höchstens 14 Tage, Unlesbares ergibt einen leeren Stand", () => {
  assert.equal(DAILY_KEEP_DAYS, 14);
  const daily: DailyCounts = {};
  for (let d = 1; d <= 20; d++) addDaily(daily, `2026-11-${String(d).padStart(2, "0")}`, "x", d);
  const back = parseDaily(serializeDaily(daily));
  assert.deepEqual(Object.keys(back), Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 7).padStart(2, "0")}`));
  assert.deepEqual(parseDaily("kein json"), {});
  assert.deepEqual(parseDaily(JSON.stringify({ days: [] })), {});
  assert.deepEqual(
    parseDaily(JSON.stringify({ days: { "2026-11-26": { a: 1, b: "2", c: -1, d: Number.NaN }, morgen: { a: 1 } } })),
    { "2026-11-26": { a: 1 } },
  );
});

test("Tag in Ortszeit: 23:30 UTC im Winter ist schon der nächste Tag", () => {
  assert.equal(localDay(new Date("2026-11-26T22:59:00Z")), "2026-11-26");
  assert.equal(localDay(new Date("2026-11-26T23:30:00Z")), "2026-11-27");
});
