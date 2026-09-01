import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundariesForDay,
  describeDay,
  describeSeasonRange,
  isOperatingAt,
  isWithinSeasonRange,
  openingForDay,
  seasonForDay,
  type ScheduleSpec,
} from "./operating-hours";

const TZ = "Europe/Berlin";

/** Sommer täglich 10–20 Uhr, Winter nur am Wochenende 11–16 Uhr. */
function strandbad(): ScheduleSpec {
  return {
    name: "Strandbad",
    seasons: [
      {
        name: "Sommer",
        startMmDd: "05-01",
        endMmDd: "09-15",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          opensAt: "10:00",
          closesAt: "20:00",
        })),
      },
      {
        name: "Winter",
        startMmDd: "11-01",
        endMmDd: "03-31",
        sortOrder: 1,
        periods: [5, 6].map((weekday) => ({
          weekday,
          opensAt: "11:00",
          closesAt: "16:00",
        })),
      },
    ],
    exceptions: [],
  };
}

test("Saison-Zeitraum erkennt Tage innerhalb und außerhalb", () => {
  assert.equal(isWithinSeasonRange("07-01", "05-01", "09-15"), true);
  assert.equal(isWithinSeasonRange("05-01", "05-01", "09-15"), true, "Starttag zählt dazu");
  assert.equal(isWithinSeasonRange("09-15", "05-01", "09-15"), true, "Endtag zählt dazu");
  assert.equal(isWithinSeasonRange("10-01", "05-01", "09-15"), false);
});

test("Saison über den Jahreswechsel schließt Januar ein", () => {
  assert.equal(isWithinSeasonRange("01-15", "11-01", "03-31"), true);
  assert.equal(isWithinSeasonRange("12-24", "11-01", "03-31"), true);
  assert.equal(isWithinSeasonRange("06-01", "11-01", "03-31"), false);
});

test("greifende Saison wird nach Datum ausgewählt", () => {
  const s = strandbad();
  assert.equal(seasonForDay(s, "2026-07-01")?.name, "Sommer");
  assert.equal(seasonForDay(s, "2026-01-10")?.name, "Winter");
  assert.equal(seasonForDay(s, "2026-10-05"), null, "zwischen den Saisons ist nichts hinterlegt");
});

test("Tag ohne passende Saison gilt als geschlossen", () => {
  const day = openingForDay(strandbad(), "2026-10-05");
  assert.equal(day.closed, true);
  assert.equal(day.source, "none");
  assert.deepEqual(day.windows, []);
});

test("Wintersaison öffnet nur am Wochenende", () => {
  const s = strandbad();
  // 2026-01-14 ist ein Mittwoch, 2026-01-17 ein Samstag.
  assert.equal(openingForDay(s, "2026-01-14").closed, true);
  const samstag = openingForDay(s, "2026-01-17");
  assert.equal(samstag.closed, false);
  assert.equal(describeDay(samstag), "11:00–16:00");
  assert.equal(samstag.label, "Winter");
});

test("Ausnahmetag schlägt die Saison", () => {
  const s = strandbad();
  s.exceptions.push({
    date: "2026-07-04",
    closed: true,
    opensAt: null,
    closesAt: null,
    note: "Betriebsversammlung",
  });
  const day = openingForDay(s, "2026-07-04");
  assert.equal(day.closed, true);
  assert.equal(day.source, "exception");
  assert.equal(day.label, "Betriebsversammlung");
  // Nachbartag bleibt unberührt.
  assert.equal(openingForDay(s, "2026-07-05").closed, false);
});

test("Ausnahmetag mit Sonderöffnungszeit gilt statt der Saison", () => {
  const s = strandbad();
  s.exceptions.push({
    date: "2026-07-04",
    closed: false,
    opensAt: "08:00",
    closesAt: "23:00",
    note: "Seefest",
  });
  const day = openingForDay(s, "2026-07-04");
  assert.equal(day.closed, false);
  assert.equal(describeDay(day), "08:00–23:00");
});

test("mehrere Perioden am Tag bilden eine Mittagspause ab", () => {
  const s: ScheduleSpec = {
    name: "Gastronomie",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [
          { weekday: 2, opensAt: "17:00", closesAt: "22:00" },
          { weekday: 2, opensAt: "11:00", closesAt: "14:00" },
        ],
      },
    ],
    exceptions: [],
  };
  // 2026-07-01 ist ein Mittwoch (weekday 2).
  const day = openingForDay(s, "2026-07-01");
  assert.equal(describeDay(day), "11:00–14:00 · 17:00–22:00", "nach Uhrzeit sortiert");

  const mittags = new Date("2026-07-01T10:30:00Z"); // 12:30 Berlin
  const pause = new Date("2026-07-01T13:00:00Z"); // 15:00 Berlin
  assert.equal(isOperatingAt(s, mittags, TZ), true);
  assert.equal(isOperatingAt(s, pause, TZ), false, "in der Mittagspause ist zu");
});

test("geöffnet-Prüfung achtet auf die Zeitzone, nicht auf UTC", () => {
  const s = strandbad();
  // 08:30 UTC = 10:30 Berlin im Sommer -> offen.
  assert.equal(isOperatingAt(s, new Date("2026-07-01T08:30:00Z"), TZ), true);
  // 07:30 UTC = 09:30 Berlin -> noch zu.
  assert.equal(isOperatingAt(s, new Date("2026-07-01T07:30:00Z"), TZ), false);
  // 18:30 UTC = 20:30 Berlin -> schon zu.
  assert.equal(isOperatingAt(s, new Date("2026-07-01T18:30:00Z"), TZ), false);
});

test("Spanne über Mitternacht reicht in den Folgetag", () => {
  const s: ScheduleSpec = {
    name: "Bar",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        // Nur Mittwoch (2) geöffnet, 18:00 bis 02:00 des Folgetags.
        periods: [{ weekday: 2, opensAt: "18:00", closesAt: "02:00" }],
      },
    ],
    exceptions: [],
  };
  const mittwoch = openingForDay(s, "2026-07-01");
  assert.equal(mittwoch.windows[0].overnight, true);

  // Mittwoch 23:00 Berlin = 21:00 UTC -> offen.
  assert.equal(isOperatingAt(s, new Date("2026-07-01T21:00:00Z"), TZ), true);
  // Donnerstag 01:00 Berlin = Mittwoch 23:00 UTC -> noch offen (Vortag).
  assert.equal(isOperatingAt(s, new Date("2026-07-01T23:00:00Z"), TZ), true);
  // Donnerstag 03:00 Berlin = 01:00 UTC -> zu.
  assert.equal(isOperatingAt(s, new Date("2026-07-02T01:00:00Z"), TZ), false);
  // Donnerstag 20:00 Berlin -> zu, Donnerstag ist kein Öffnungstag.
  assert.equal(isOperatingAt(s, new Date("2026-07-02T18:00:00Z"), TZ), false);
});

test("gleiche Öffnungs- und Schließzeit heißt durchgehend geöffnet", () => {
  const s: ScheduleSpec = {
    name: "Technik",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [{ weekday: 2, opensAt: "00:00", closesAt: "00:00" }],
      },
    ],
    exceptions: [],
  };
  assert.equal(isOperatingAt(s, new Date("2026-07-01T03:00:00Z"), TZ), true);
  assert.equal(isOperatingAt(s, new Date("2026-07-01T21:00:00Z"), TZ), true);
});

test("ohne Profil gilt der Raum als verfügbar", () => {
  assert.equal(isOperatingAt(null, new Date("2026-07-01T03:00:00Z"), TZ), true);
});

test("Betriebsbeginn und -ende kommen als echte Zeitpunkte", () => {
  const grenzen = boundariesForDay(strandbad(), "2026-07-01", TZ);
  assert.equal(grenzen.length, 2);
  assert.equal(grenzen[0].kind, "open");
  // 10:00 Berlin im Sommer = 08:00 UTC.
  assert.equal(grenzen[0].at.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(grenzen[1].kind, "close");
  assert.equal(grenzen[1].at.toISOString(), "2026-07-01T18:00:00.000Z");
});

test("Betriebsende einer Nachtspanne liegt am Folgetag", () => {
  const s: ScheduleSpec = {
    name: "Bar",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [{ weekday: 2, opensAt: "18:00", closesAt: "02:00" }],
      },
    ],
    exceptions: [],
  };
  const grenzen = boundariesForDay(s, "2026-07-01", TZ);
  assert.equal(grenzen[0].at.toISOString(), "2026-07-01T16:00:00.000Z", "18:00 Berlin");
  assert.equal(grenzen[1].at.toISOString(), "2026-07-02T00:00:00.000Z", "02:00 Berlin am Folgetag");
});

test("Winterzeit verschiebt den Betriebsbeginn korrekt", () => {
  const s: ScheduleSpec = {
    name: "Ganzjährig",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          opensAt: "10:00",
          closesAt: "20:00",
        })),
      },
    ],
    exceptions: [],
  };
  // Im Januar gilt MEZ: 10:00 Berlin = 09:00 UTC (im Juli wären es 08:00).
  const winter = boundariesForDay(s, "2026-01-15", TZ);
  assert.equal(winter[0].at.toISOString(), "2026-01-15T09:00:00.000Z");
  const sommer = boundariesForDay(s, "2026-07-15", TZ);
  assert.equal(sommer[0].at.toISOString(), "2026-07-15T08:00:00.000Z");
});

test("Umstellungstag auf Sommerzeit bleibt korrekt", () => {
  const s: ScheduleSpec = {
    name: "Ganzjährig",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          opensAt: "10:00",
          closesAt: "20:00",
        })),
      },
    ],
    exceptions: [],
  };
  // 2026-03-29 ist der Umstellungstag; ab 02:00 gilt MESZ.
  const grenzen = boundariesForDay(s, "2026-03-29", TZ);
  assert.equal(grenzen[0].at.toISOString(), "2026-03-29T08:00:00.000Z", "10:00 MESZ");
});

test("Saison-Zeitraum wird lesbar dargestellt", () => {
  assert.equal(describeSeasonRange("05-01", "09-15"), "01.05.–15.09.");
});
