import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOSED,
  annyDayValues,
  compareDays,
  daysBetween,
  matchWebsiteSlug,
  parseWebsiteTime,
  scheduleDayValue,
  websiteDayValue,
  type WebsitePeriodRow,
} from "./opening-compare";
import type { ScheduleSpec } from "./operating-hours";

const wake: ScheduleSpec = {
  name: "Wasserski",
  seasons: [
    {
      name: "Saisonstart",
      startMmDd: "03-13",
      endMmDd: "03-21",
      sortOrder: 0,
      periods: [
        { weekday: 5, opensAt: "12:00", closesAt: "16:00" },
        { weekday: 6, opensAt: "12:00", closesAt: "16:00" },
      ],
    },
  ],
  exceptions: [{ date: "2027-03-19", closed: false, opensAt: "14:00", closesAt: "18:00", note: "Test" }],
};

test("scheduleDayValue: Saisontag, geschlossener Wochentag, Ausnahme", () => {
  assert.equal(scheduleDayValue(wake, "2027-03-13"), "12:00–16:00"); // Sa
  assert.equal(scheduleDayValue(wake, "2027-03-15"), CLOSED); // Mo
  assert.equal(scheduleDayValue(wake, "2027-03-19"), "14:00–18:00"); // Fr, Ausnahme
  assert.equal(scheduleDayValue(wake, "2027-01-10"), CLOSED); // keine Saison
});

test("annyDayValues: Perioden je Berliner Tag, Lücken zählen nicht", () => {
  const map = annyDayValues(
    [
      { start: "2026-07-01T10:00:00+02:00", end: "2026-07-01T13:00:00+02:00" },
      { start: "2026-07-01T15:00:00+02:00", end: "2026-07-01T20:00:00+02:00" },
      { start: "2026-12-06T11:00:00Z", end: "2026-12-06T15:00:00Z" },
    ],
    "Europe/Berlin",
  );
  assert.equal(map.get("2026-07-01"), "10:00–20:00");
  assert.equal(map.get("2026-12-06"), "12:00–16:00");
});

test("parseWebsiteTime: übliche Schreibweisen", () => {
  assert.equal(parseWebsiteTime("12:00 - 18:00"), "12:00–18:00");
  assert.equal(parseWebsiteTime("10 – 20 Uhr"), "10:00–20:00");
  assert.equal(parseWebsiteTime("nach Absprache"), null);
  assert.equal(parseWebsiteTime(null), null);
});

test("websiteDayValue: Datum vor Zeitraum, Wochentag vor ganzem Zeitraum", () => {
  const periods: WebsitePeriodRow[] = [
    { validFrom: "2026-05-01", validTo: "2026-07-19", jsDay: null, timeText: null, isClosed: true, priority: 0 },
    { validFrom: "2026-05-01", validTo: "2026-07-19", jsDay: 0, timeText: "10:00 - 20:00", isClosed: false, priority: 0 },
  ];
  const dates = [{ date: "2026-05-25", timeText: "10:00 - 20:00", isClosed: false }];
  assert.equal(websiteDayValue(periods, dates, "2026-05-03"), "10:00–20:00"); // So
  assert.equal(websiteDayValue(periods, dates, "2026-05-04"), CLOSED); // Mo, ganzer Zeitraum zu
  assert.equal(websiteDayValue(periods, dates, "2026-05-25"), "10:00–20:00"); // Datumseintrag
  assert.equal(websiteDayValue(periods, dates, "2026-08-01"), null); // keine Angabe
});

test("compareDays: gleiche Wertepaare zusammengefasst, fehlende Angabe bei zu ist gleich", () => {
  const days = daysBetween("2027-03-13", "2027-03-21");
  assert.equal(days.length, 9);
  const result = compareDays(
    days,
    (d) => scheduleDayValue(wake, d),
    (d) => (d === "2027-03-14" ? "12:00–16:00" : null),
  );
  // Sa 13., Fr 19. (Ausnahme), Sa 20., So 21. offen bei uns, anny ohne Angabe; So 14. gleich.
  assert.equal(result.differing, 4);
  assert.equal(result.missing, 8);
  assert.equal(result.firstDiff, "2027-03-13");
  assert.deepEqual(
    result.groups.map((g) => [g.ours, g.theirs, g.first, g.last, g.days]),
    [
      ["12:00–16:00", null, "2027-03-13", "2027-03-21", 3],
      ["14:00–18:00", null, "2027-03-19", "2027-03-19", 1],
    ],
  );
});

test("matchWebsiteSlug: Name, Anfang und Lift", () => {
  const slugs = ["strandbad", "aquapark", "sup", "wakeboard", "gastro", "shop", "home"];
  assert.equal(matchWebsiteSlug("Strandbad", slugs), "strandbad");
  assert.equal(matchWebsiteSlug("SUP", slugs), "sup");
  assert.equal(matchWebsiteSlug("Gastronomie", slugs), "gastro");
  assert.equal(matchWebsiteSlug("Wasserski", slugs), "wakeboard");
  assert.equal(matchWebsiteSlug("Grillplatz", slugs), null);
});
