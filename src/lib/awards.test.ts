import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AWARD_DEFAULTS,
  awardCategory,
  awardFace,
  awardRemainingText,
  awardShape,
  awardText,
  compactNumber,
  nextAward,
  tierRank,
  tileSpans,
  voucherHeadline,
  voucherShortLabel,
} from "./awards";
import { GAMI_METRICS, GAMI_PERIODS, GAMI_TIERS } from "./gamification";
import { milestoneSchema, normalizeMilestone } from "./gamification-input";

test("awardCategory und awardShape: Reihe und Form folgen der Kennzahl", () => {
  assert.equal(awardCategory("STARTS"), "starts");
  assert.equal(awardCategory("VISIT_DAYS"), "days");
  assert.equal(awardCategory("SEASONS"), "loyalty");
  for (const m of ["STREAK_WEEKS", "EARLY_DAYS", "WEEKENDS", "EVENT_DAYS"] as const) assert.equal(awardCategory(m), "special");
  assert.equal(awardShape("STARTS"), "hex");
  assert.equal(awardShape("VISIT_DAYS"), "circle");
  assert.equal(awardShape("WEEKENDS"), "star");
  assert.equal(awardShape("SEASONS"), "crest");
});

test("compactNumber und awardFace: Zahl mit Einheit oder Symbol", () => {
  assert.equal(compactNumber(250), "250");
  assert.equal(compactNumber(1000), "1K");
  assert.equal(compactNumber(2500), "2.5K");
  assert.deepEqual(awardFace({ metric: "STARTS", threshold: 1 }), { big: "1", sub: "START" });
  assert.deepEqual(awardFace({ metric: "STARTS", threshold: 2500 }), { big: "2.5K", sub: "STARTS" });
  assert.deepEqual(awardFace({ metric: "VISIT_DAYS", threshold: 30 }), { big: "30", sub: "TAGE" });
  assert.deepEqual(awardFace({ metric: "SEASONS", threshold: 10 }), { big: "10", sub: "SAISONS" });
  assert.deepEqual(awardFace({ metric: "EARLY_DAYS", threshold: 5 }), { icon: "sun" });
  assert.deepEqual(awardFace({ metric: "WEEKENDS", threshold: 3 }), { icon: "flame" });
  assert.deepEqual(awardFace({ metric: "EVENT_DAYS", threshold: 1, key: "day-one" }), { icon: "flag", mark: "1" });
  assert.deepEqual(awardFace({ metric: "EVENT_DAYS", threshold: 1, key: "ice-breaker" }), { icon: "snow" });
});

test("awardText: eigene Beschreibung geht vor, sonst ein Satz aus Kennzahl und Zeitraum", () => {
  assert.equal(awardText({ metric: "STARTS", threshold: 1, period: "ALL_TIME" }), "Dein erster Start am Lift.");
  assert.equal(awardText({ metric: "STARTS", threshold: 2500, period: "ALL_TIME" }), "2.500 Starts am Lift.");
  assert.equal(awardText({ metric: "VISIT_DAYS", threshold: 15, period: "SEASON" }), "15 Besuchstage in einer Saison.");
  assert.equal(awardText({ metric: "VISIT_DAYS", threshold: 4, period: "MONTH" }), "4 Besuchstage in einem Monat.");
  assert.equal(awardText({ metric: "SEASONS", threshold: 3, period: "ALL_TIME" }), "3 Saisons mit mindestens einem Start.");
  assert.equal(awardText({ metric: "EVENT_DAYS", threshold: 1, period: "SEASON" }), "Start an einem Aktionstag.");
  assert.equal(awardText({ metric: "STARTS", threshold: 1, period: "ALL_TIME", hint: " Dein allererster Start. " }), "Dein allererster Start.");
});

test("awardRemainingText: was noch fehlt", () => {
  assert.equal(awardRemainingText({ metric: "VISIT_DAYS", threshold: 15, period: "SEASON", value: 11 }), "Noch 4 Besuchstage in dieser Saison.");
  assert.equal(awardRemainingText({ metric: "STARTS", threshold: 100, period: "ALL_TIME", value: 99 }), "Noch 1 Start.");
  assert.equal(awardRemainingText({ metric: "SEASONS", threshold: 5, period: "ALL_TIME", value: 3 }), "Noch 2 Saisons.");
  assert.equal(awardRemainingText({ metric: "WEEKENDS", threshold: 3, period: "SEASON", value: 2 }), "Deine längste Serie in dieser Saison: 2 von 3.");
  assert.equal(awardRemainingText({ metric: "EVENT_DAYS", threshold: 1, period: "SEASON", value: 0 }), "Sei an einem Aktionstag am Start.");
});

test("voucherShortLabel und voucherHeadline", () => {
  assert.equal(voucherShortLabel({ voucherLabel: null }), null);
  assert.equal(voucherShortLabel({ voucherLabel: "Ein Eis nach Wahl" }), "Ein Eis nach Wahl");
  assert.equal(voucherShortLabel({ voucherLabel: "Bring a Friend: Tageskarte für eine Begleitung" }), "Bring a Friend");
  assert.equal(voucherShortLabel({ voucherLabel: "Ein Eis nach Wahl", voucherShort: " Eis " }), "Eis");
  assert.deepEqual(voucherHeadline("Bring a Friend: Tageskarte für eine Begleitung"), { head: "Bring a Friend", detail: "Tageskarte für eine Begleitung" });
  assert.deepEqual(voucherHeadline("Eine Portion Steakhaus Pommes", "Pommes"), { head: "Pommes", detail: "Eine Portion Steakhaus Pommes" });
  assert.deepEqual(voucherHeadline("Ein Eis nach Wahl"), { head: "Ein Eis nach Wahl", detail: null });
});

test("nextAward: der gesperrte Award mit dem größten Anteil am Ziel, ohne Aktionstage", () => {
  const a = (id: number, metric: "STARTS" | "VISIT_DAYS" | "EVENT_DAYS" | "SEASONS", threshold: number, value: number, unlocked = false) =>
    ({ id, metric, threshold, value, unlocked });
  assert.equal(nextAward([]), null);
  assert.equal(nextAward([a(1, "STARTS", 25, 25, true)]), null);
  const list = [a(1, "STARTS", 25, 25, true), a(2, "STARTS", 100, 60), a(3, "VISIT_DAYS", 5, 4), a(4, "EVENT_DAYS", 1, 0)];
  assert.equal(nextAward(list)?.id, 3);
  // Ohne jeden Fortschritt der erste offene der Liste.
  assert.equal(nextAward([a(2, "STARTS", 100, 0), a(3, "VISIT_DAYS", 5, 0)])?.id, 2);
  assert.equal(nextAward([a(4, "EVENT_DAYS", 1, 0)]), null);
  // Treue kommt erst dran, wenn sonst nichts mehr offen ist.
  assert.equal(nextAward([a(5, "SEASONS", 10, 7), a(2, "STARTS", 25, 13)])?.id, 2);
  assert.equal(nextAward([a(5, "SEASONS", 10, 7), a(2, "STARTS", 25, 25, true)])?.id, 5);
});

test("tileSpans füllt die letzte Zeile des Dreier-Rasters", () => {
  assert.deepEqual(tileSpans(0), []);
  assert.deepEqual(tileSpans(3), [1, 1, 1]);
  assert.deepEqual(tileSpans(4), [1, 1, 1, 3]);
  assert.deepEqual(tileSpans(5), [1, 1, 1, 1, 2]);
  assert.deepEqual(tileSpans(7), [1, 1, 1, 1, 1, 1, 3]);
});

test("tierRank ordnet Bronze bis Legendary", () => {
  assert.deepEqual([...GAMI_TIERS].sort((x, y) => tierRank(y) - tierRank(x)), ["LEGENDARY", "GOLD", "SILVER", "BRONZE"]);
});

test("Vorlage: 20 Awards, eindeutig, mit Gutschein und in der Verwaltung speicherbar", () => {
  assert.equal(AWARD_DEFAULTS.length, 20);
  assert.equal(new Set(AWARD_DEFAULTS.map((a) => a.key)).size, 20);
  assert.equal(new Set(AWARD_DEFAULTS.map((a) => a.name)).size, 20);
  for (const a of AWARD_DEFAULTS) {
    assert.ok(GAMI_METRICS.includes(a.metric), a.key);
    assert.ok(GAMI_PERIODS.includes(a.period), a.key);
    assert.ok(GAMI_TIERS.includes(a.tier), a.key);
    assert.ok(a.voucherLabel.trim() && a.voucherShort.trim(), a.key);
    // Treue zählt über alle Jahre, sonst gäbe es den Award jedes Jahr neu.
    if (a.metric === "SEASONS") assert.equal(a.period, "ALL_TIME", a.key);
    // Dieselben Grenzen wie im Formular: was die Vorlage anlegt, lässt sich dort wieder speichern.
    const parsed = milestoneSchema.safeParse({
      name: a.name,
      metric: a.metric,
      threshold: a.threshold,
      period: a.period,
      tier: a.tier,
      voucherLabel: a.voucherLabel,
      voucherShort: a.voucherShort,
      voucherValidDays: a.voucherValidDays,
      bonus: a.bonus ?? null,
      hint: a.hint ?? null,
      active: true,
    });
    assert.ok(parsed.success, `${a.key}: ${parsed.success ? "" : parsed.error.message}`);
  }
  // Die Ziele einer Reihe steigen mit der Seltenheit.
  for (const metric of ["STARTS", "VISIT_DAYS", "SEASONS"] as const) {
    const row = AWARD_DEFAULTS.filter((a) => a.metric === metric);
    for (let i = 1; i < row.length; i++) {
      assert.ok(row[i].threshold > row[i - 1].threshold, `${metric} ${row[i].key}`);
      assert.ok(tierRank(row[i].tier) >= tierRank(row[i - 1].tier), `${metric} ${row[i].key}`);
    }
  }
});

test("normalizeMilestone: Saisons zählen immer über alle Jahre, Aktionstage nur beim passenden Ziel", () => {
  const base = { name: "Test", threshold: 3, voucherLabel: null, voucherValidDays: null, active: true };
  const seasons = normalizeMilestone(milestoneSchema.parse({ ...base, metric: "SEASONS", period: "SEASON", eventDays: ["2027-04-03"] }));
  assert.equal(seasons.period, "ALL_TIME");
  assert.deepEqual(seasons.eventDays, []);
  const event = normalizeMilestone(milestoneSchema.parse({ ...base, metric: "EVENT_DAYS", period: "SEASON", eventDays: ["2027-04-03", "2027-04-03", "2027-03-28"] }));
  assert.deepEqual((event.eventDays ?? []).map((d) => d.toISOString().slice(0, 10)), ["2027-03-28", "2027-04-03"]);
});
