import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundariesForDay,
  describeDay,
  describeOccurrence,
  describeSeasonRange,
  dueOperatingOccurrence,
  isOperatingAt,
  isWithinOperatingSpan,
  isWithinSeasonRange,
  nextOperatingOccurrence,
  openingForDay,
  operatingBoundary,
  operatingOccurrenceForDay,
  operatingSpanState,
  operatingSpansForDay,
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

// ─── Betriebszeit-Ausloeser ──────────────────────────────────────────────────

/** Gastronomie: täglich 18:00–02:00, also über Mitternacht. */
function nachtbetrieb(): ScheduleSpec {
  return {
    name: "Gastronomie",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          opensAt: "18:00",
          closesAt: "02:00",
        })),
      },
    ],
    exceptions: [],
  };
}

const MINUTE = 60_000;
const AUDIO_WINDOW = { beforeMs: 0, afterMs: 5 * MINUTE };
const RULE_WINDOW = { beforeMs: 3 * MINUTE, afterMs: 3 * MINUTE };

test("Betriebsbeginn und -ende eines Tags als Zeitpunkt", () => {
  const s = strandbad();
  // Sommer, Berlin = UTC+2: 10:00 Ortszeit ist 08:00Z.
  assert.equal(
    operatingBoundary(s, "2026-07-01", "open", TZ)?.toISOString(),
    "2026-07-01T08:00:00.000Z",
  );
  assert.equal(
    operatingBoundary(s, "2026-07-01", "close", TZ)?.toISOString(),
    "2026-07-01T18:00:00.000Z",
  );
  assert.equal(operatingBoundary(s, "2026-10-05", "open", TZ), null, "geschlossen");
});

test("Versatz verschiebt den Zeitpunkt, Wochentage filtern den Betriebstag", () => {
  const s = strandbad();
  // 2026-07-01 ist ein Mittwoch (Bit 2).
  const vorher = operatingOccurrenceForDay(
    s,
    { kind: "close", offsetMinutes: -15, daysOfWeek: 127 },
    "2026-07-01",
    TZ,
  );
  assert.equal(vorher?.at.toISOString(), "2026-07-01T17:45:00.000Z");
  assert.equal(vorher?.ymd, "2026-07-01");

  const nurMontag = operatingOccurrenceForDay(
    s,
    { kind: "close", offsetMinutes: 0, daysOfWeek: 1 },
    "2026-07-01",
    TZ,
  );
  assert.equal(nurMontag, null);
});

test("fällig nur im Fenster nach dem Zeitpunkt", () => {
  const s = strandbad();
  const trigger = { kind: "open" as const, offsetMinutes: 0, daysOfWeek: 127 };
  const at = (iso: string) => dueOperatingOccurrence(s, trigger, new Date(iso), TZ, AUDIO_WINDOW);
  assert.equal(at("2026-07-01T07:59:00Z"), null, "eine Minute zu früh");
  assert.equal(at("2026-07-01T08:00:00Z")?.at.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(at("2026-07-01T08:04:30Z")?.at.toISOString(), "2026-07-01T08:00:00.000Z", "Nachholfenster");
  assert.equal(at("2026-07-01T08:05:00Z"), null, "Fenster zu");
});

test("Betriebsende nach Mitternacht gehört zum Vortag und wird trotzdem gefunden", () => {
  const s = nachtbetrieb();
  // 02:00 Berlin am 2.7. = 00:00Z; der Betriebstag ist der 1.7.
  const occ = dueOperatingOccurrence(
    s,
    { kind: "close", offsetMinutes: 0, daysOfWeek: 127 },
    new Date("2026-07-02T00:01:00Z"),
    TZ,
    AUDIO_WINDOW,
  );
  assert.equal(occ?.at.toISOString(), "2026-07-02T00:00:00.000Z");
  assert.equal(occ?.ymd, "2026-07-01");
});

test("Wochentag zählt für den Betriebstag, nicht für den Kalendertag des Endes", () => {
  const s = nachtbetrieb();
  // 2026-07-03 ist ein Freitag; sein Ende liegt Samstag 02:00. "nur Freitag"
  // muss dieses Ende treffen, "nur Samstag" nicht.
  const nurFreitag = dueOperatingOccurrence(
    s,
    { kind: "close", offsetMinutes: 0, daysOfWeek: 1 << 4 },
    new Date("2026-07-04T00:00:30Z"),
    TZ,
    AUDIO_WINDOW,
  );
  assert.equal(nurFreitag?.ymd, "2026-07-03");
  const nurSamstag = dueOperatingOccurrence(
    s,
    { kind: "close", offsetMinutes: 0, daysOfWeek: 1 << 5 },
    new Date("2026-07-04T00:00:30Z"),
    TZ,
    AUDIO_WINDOW,
  );
  assert.equal(nurSamstag, null);
});

test("Versatz vor Mitternacht zeigt auf den morgigen Betriebsbeginn", () => {
  // Regel-Fenster (±3 min): Beginn 18:00 minus 19 Stunden = 23:00 am Vortag.
  const s = nachtbetrieb();
  const occ = dueOperatingOccurrence(
    s,
    { kind: "open", offsetMinutes: -19 * 60, daysOfWeek: 127 },
    new Date("2026-06-30T21:01:00Z"), // 23:01 Berlin am 30.6.
    TZ,
    RULE_WINDOW,
  );
  assert.equal(occ?.ymd, "2026-07-01");
  assert.equal(occ?.at.toISOString(), "2026-06-30T21:00:00.000Z");
});

test("nächster Termin für die Anzeige: heute, morgen, Wochentag", () => {
  const s = strandbad();
  const trigger = { kind: "close" as const, offsetMinutes: -15, daysOfWeek: 127 };
  const now = new Date("2026-07-01T10:00:00Z"); // Mittwoch 12:00 Berlin
  const heute = nextOperatingOccurrence(s, trigger, now, TZ);
  assert.equal(heute && describeOccurrence(heute, now, TZ), "heute 19:45");

  const spaet = new Date("2026-07-01T18:30:00Z"); // 20:30 Berlin, Ende vorbei
  const morgen = nextOperatingOccurrence(s, trigger, spaet, TZ);
  assert.equal(morgen && describeOccurrence(morgen, spaet, TZ), "morgen 19:45");

  // Winter: nur Samstag/Sonntag. Am Mittwoch, 14.1., ist der nächste Termin Samstag.
  const winter = new Date("2026-01-14T10:00:00Z");
  const samstag = nextOperatingOccurrence(s, trigger, winter, TZ);
  assert.equal(samstag && describeOccurrence(samstag, winter, TZ), "Sa 15:45");
});

test("Kulanz hält den laufenden Termin in der Anzeige", () => {
  const s = strandbad();
  const trigger = { kind: "open" as const, offsetMinutes: 0, daysOfWeek: 127 };
  const now = new Date("2026-07-01T08:02:00Z"); // zwei Minuten nach Beginn
  assert.equal(
    nextOperatingOccurrence(s, trigger, now, TZ, 5 * MINUTE)?.ymd,
    "2026-07-01",
    "im Nachholfenster bleibt heute stehen",
  );
  assert.equal(nextOperatingOccurrence(s, trigger, now, TZ)?.ymd, "2026-07-02", "ohne Kulanz morgen");
});

// ── Verschobene Oeffnungsspannen (Musik nur zur Betriebszeit) ───────────────

/** Sommerzeit: 10:00 Berlin = 08:00 UTC. */
function utc(iso: string): Date {
  return new Date(iso);
}

test("Öffnungsspanne als Zeitpunkte, an beiden Enden verschoben", () => {
  const spans = operatingSpansForDay(strandbad(), "2026-07-01", TZ, {
    openMinutes: -30,
    closeMinutes: 30,
  });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].from.toISOString(), utc("2026-07-01T07:30:00Z").toISOString());
  assert.equal(spans[0].to.toISOString(), utc("2026-07-01T18:30:00Z").toISOString());
  assert.equal(spans[0].ymd, "2026-07-01");
});

test("ohne Versatz stimmt die Spanne mit isOperatingAt überein", () => {
  const s = strandbad();
  for (const iso of ["2026-07-01T07:59:00Z", "2026-07-01T08:00:00Z", "2026-07-01T17:59:00Z", "2026-07-01T18:00:00Z", "2026-07-01T22:00:00Z"]) {
    assert.equal(isWithinOperatingSpan(s, utc(iso), TZ), isOperatingAt(s, utc(iso), TZ), iso);
  }
});

test("Versatz öffnet das Fenster vor Betriebsbeginn und schließt es nach Betriebsende", () => {
  const s = strandbad();
  const offsets = { openMinutes: -30, closeMinutes: 30 };
  assert.equal(isWithinOperatingSpan(s, utc("2026-07-01T07:29:00Z"), TZ, offsets), false, "09:29");
  assert.equal(isWithinOperatingSpan(s, utc("2026-07-01T07:30:00Z"), TZ, offsets), true, "09:30");
  assert.equal(isWithinOperatingSpan(s, utc("2026-07-01T18:29:00Z"), TZ, offsets), true, "20:29");
  assert.equal(isWithinOperatingSpan(s, utc("2026-07-01T18:30:00Z"), TZ, offsets), false, "20:30");
});

test("negativer Versatz am Ende schließt das Fenster vor Betriebsende", () => {
  const s = strandbad();
  const offsets = { openMinutes: 0, closeMinutes: -15 };
  assert.equal(isWithinOperatingSpan(s, utc("2026-07-01T17:44:00Z"), TZ, offsets), true, "19:44");
  assert.equal(isWithinOperatingSpan(s, utc("2026-07-01T17:45:00Z"), TZ, offsets), false, "19:45");
});

test("ohne Profil ist das Fenster immer offen, an geschlossenen Tagen nie", () => {
  assert.equal(isWithinOperatingSpan(null, utc("2026-07-01T12:00:00Z"), TZ, { openMinutes: -60, closeMinutes: 60 }), true);
  // 2026-01-14 ist ein Mittwoch – im Winter geschlossen.
  assert.equal(isWithinOperatingSpan(strandbad(), utc("2026-01-14T12:00:00Z"), TZ), false);
});

test("Nachtspanne mit Versatz reicht bis in den Folgetag", () => {
  const s: ScheduleSpec = {
    name: "Bar",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "18:00", closesAt: "02:00" })),
      },
    ],
    exceptions: [],
  };
  const offsets = { openMinutes: 0, closeMinutes: 60 };
  // 02:30 Berlin am 2.7. = 00:30 UTC – Betriebsende 02:00 plus eine Stunde.
  assert.equal(isWithinOperatingSpan(s, utc("2026-07-02T00:30:00Z"), TZ, offsets), true);
  assert.equal(isWithinOperatingSpan(s, utc("2026-07-02T01:00:00Z"), TZ, offsets), false, "03:00");
});

test("Versatz legt Spannen zusammen, die sich berühren", () => {
  const s: ScheduleSpec = {
    name: "Mit Mittagspause",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
          { weekday, opensAt: "10:00", closesAt: "14:00" },
          { weekday, opensAt: "15:00", closesAt: "20:00" },
        ]),
      },
    ],
    exceptions: [],
  };
  // Ohne Versatz: in der Pause keine Musik, der Zustand kippt um 15:00.
  const pause = operatingSpanState(s, utc("2026-07-01T12:30:00Z"), TZ);
  assert.equal(pause.inside, false);
  assert.equal(pause.until?.toISOString(), utc("2026-07-01T13:00:00Z").toISOString());
  // Mit einer halben Stunde an beiden Enden verschwindet die Pause.
  const merged = operatingSpanState(s, utc("2026-07-01T12:30:00Z"), TZ, { openMinutes: -30, closeMinutes: 30 });
  assert.equal(merged.inside, true);
  assert.equal(merged.until?.toISOString(), utc("2026-07-01T18:30:00Z").toISOString(), "bis 20:30 Berlin");
});

test("Zustand nennt den nächsten Wechsel: Ende der laufenden, Beginn der nächsten Spanne", () => {
  const s = strandbad();
  const offsets = { openMinutes: -30, closeMinutes: 30 };
  const inside = operatingSpanState(s, utc("2026-07-01T12:00:00Z"), TZ, offsets);
  assert.equal(inside.inside, true);
  assert.equal(inside.until?.toISOString(), utc("2026-07-01T18:30:00Z").toISOString());

  const evening = operatingSpanState(s, utc("2026-07-01T20:00:00Z"), TZ, offsets);
  assert.equal(evening.inside, false);
  assert.equal(evening.until?.toISOString(), utc("2026-07-02T07:30:00Z").toISOString(), "morgen 09:30");

  // Zwischen den Saisons: kein Wechsel in Sicht.
  const gap = operatingSpanState(s, utc("2026-10-05T12:00:00Z"), TZ, offsets);
  assert.equal(gap.inside, false);
  assert.equal(gap.until, null);
});

