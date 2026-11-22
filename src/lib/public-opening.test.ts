import { test } from "node:test";
import assert from "node:assert/strict";
import { areaKey, matchesArea, parsePublicQuery, publicArea, publicDay } from "./public-opening";
import type { ScheduleSpec } from "./operating-hours";

const wasserski: ScheduleSpec = {
  name: "Wasserski",
  seasons: [
    {
      name: "Winter",
      startMmDd: "11-07",
      endMmDd: "12-31",
      sortOrder: 0,
      periods: [
        { weekday: 5, opensAt: "12:00", closesAt: "16:00" },
        { weekday: 6, opensAt: "12:00", closesAt: "16:00" },
      ],
    },
  ],
  exceptions: [
    { date: "2026-12-06", closed: false, opensAt: "10:00", closesAt: "18:00", note: "Nikolaus" },
    { date: "2026-12-26", closed: true, opensAt: null, closesAt: null, note: "2. Weihnachtstag" },
  ],
};

test("areaKey: Umlaute und Sonderzeichen", () => {
  assert.equal(areaKey("Wasserski & Shop"), "wasserski-shop");
  assert.equal(areaKey("Gastronomie"), "gastronomie");
  assert.equal(areaKey("Grillplatz Süd"), "grillplatz-sued");
  assert.equal(areaKey("Café"), "cafe");
  assert.equal(areaKey("SUP"), "sup");
});

test("publicDay: regulärer Tag mit Zeiten", () => {
  assert.deepEqual(publicDay(wasserski, "2026-11-28"), {
    datum: "2026-11-28",
    geoeffnet: true,
    zeiten: [{ von: "12:00", bis: "16:00" }],
    text: "12:00 - 16:00",
    ausnahme: false,
    hinweis: null,
  });
});

test("publicDay: Wochentag ohne Zeiten ist geschlossen, Saisonname bleibt intern", () => {
  const d = publicDay(wasserski, "2026-11-24");
  assert.equal(d.geoeffnet, false);
  assert.equal(d.text, "geschlossen");
  assert.equal(d.hinweis, null);
});

test("publicDay: Ausnahmen mit Hinweis", () => {
  const nikolaus = publicDay(wasserski, "2026-12-06");
  assert.equal(nikolaus.text, "10:00 - 18:00");
  assert.equal(nikolaus.ausnahme, true);
  assert.equal(nikolaus.hinweis, "Nikolaus");
  const zu = publicDay(wasserski, "2026-12-26");
  assert.equal(zu.geoeffnet, false);
  assert.equal(zu.hinweis, "2. Weihnachtstag");
});

test("publicDay: außerhalb jeder Saison geschlossen", () => {
  assert.equal(publicDay(wasserski, "2027-01-10").geoeffnet, false);
});

test("publicArea: Tage am Stück über den Monatswechsel", () => {
  const a = publicArea({ id: 5, name: "Wasserski", spec: wasserski }, "2026-11-29", 3);
  assert.equal(a.schluessel, "wasserski");
  assert.deepEqual(a.tage.map((t) => t.datum), ["2026-11-29", "2026-11-30", "2026-12-01"]);
});

test("parsePublicQuery: Vorgaben, tage und bis", () => {
  const today = "2026-11-22";
  assert.deepEqual(parsePublicQuery(new URLSearchParams(""), today), { from: today, days: 14, areas: [] });
  assert.deepEqual(parsePublicQuery(new URLSearchParams("tage=1&bereich=wasserski,Gastro"), today), {
    from: today,
    days: 1,
    areas: ["wasserski", "gastro"],
  });
  assert.deepEqual(parsePublicQuery(new URLSearchParams("von=2026-12-30&bis=2027-01-02"), today), {
    from: "2026-12-30",
    days: 4,
    areas: [],
  });
  assert.ok("error" in parsePublicQuery(new URLSearchParams("tage=401"), today));
  assert.ok("error" in parsePublicQuery(new URLSearchParams("von=22.11.2026"), today));
  assert.ok("error" in parsePublicQuery(new URLSearchParams("von=2026-12-02&bis=2026-12-01"), today));
  assert.ok("error" in parsePublicQuery(new URLSearchParams("tage=0"), today));
});

test("matchesArea: Schlüssel, Anfang und Id", () => {
  const s = { id: 4, name: "Gastronomie" };
  assert.equal(matchesArea(s, []), true);
  assert.equal(matchesArea(s, ["gastronomie"]), true);
  assert.equal(matchesArea(s, ["4"]), true);
  assert.equal(matchesArea(s, ["strandbad"]), false);
  assert.equal(matchesArea({ id: 5, name: "Wasserski & Shop" }, ["wasserski"]), true);
});
