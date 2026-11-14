import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeMusicState,
  describeMusicWindow,
  formatMusicTimes,
  manualMusicOverrideUntil,
  musicWindowState,
  parseMusicTimes,
  parseOffsetMinutes,
} from "./audio-constants";
import type { ScheduleSpec } from "./operating-hours";

const TZ = "Europe/Berlin";

/** Täglich 10–20 Uhr, ganzjährig. */
function daily(): ScheduleSpec {
  return {
    name: "Park",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "10:00", closesAt: "20:00" })),
      },
    ],
    exceptions: [],
  };
}

test("Versatz: ganze Minuten bis zwölf Stunden, leer und Unsinn sind ungültig", () => {
  assert.equal(parseOffsetMinutes(-30), -30);
  assert.equal(parseOffsetMinutes("45"), 45);
  assert.equal(parseOffsetMinutes(0), 0);
  assert.equal(parseOffsetMinutes(721), null);
  assert.equal(parseOffsetMinutes(1.5), null);
  assert.equal(parseOffsetMinutes(""), null);
  assert.equal(parseOffsetMinutes("abc"), null);
  assert.equal(parseOffsetMinutes(undefined), null);
});

function operating(open = 0, close = 0) {
  return { musicMode: "OPERATING" as const, musicTimes: [], musicOpenOffset: open, musicCloseOffset: close };
}

function times(musicTimes: unknown) {
  return { musicMode: "TIMES" as const, musicTimes, musicOpenOffset: 0, musicCloseOffset: 0 };
}

/** Restaurant: Mo zu, Di–Fr 12–20, Sa+So 10–20. */
const RESTAURANT = [
  ...[1, 2, 3, 4].map((weekday) => ({ weekday, from: "12:00", to: "20:00" })),
  ...[5, 6].map((weekday) => ({ weekday, from: "10:00", to: "20:00" })),
];

test("ohne Automatik oder ohne Betriebszeit ist Musik jederzeit erlaubt", () => {
  const now = new Date("2026-07-01T22:00:00Z");
  assert.deepEqual(
    musicWindowState({ ...operating(), musicMode: "MANUAL" }, daily(), now, TZ),
    { allowed: true, until: null },
  );
  assert.deepEqual(musicWindowState(operating(), null, now, TZ), { allowed: true, until: null });
  assert.deepEqual(musicWindowState(times([]), daily(), now, TZ), { allowed: true, until: null });
});

test("Musik von Betriebsbeginn −30 bis Betriebsende +30, mit nächstem Wechsel", () => {
  const zone = operating(-30, 30);
  // 15:00 Berlin: erlaubt bis 20:30.
  const day = musicWindowState(zone, daily(), new Date("2026-07-01T13:00:00Z"), TZ);
  assert.equal(day.allowed, true);
  assert.equal(day.until?.toISOString(), "2026-07-01T18:30:00.000Z");
  // 21:00 Berlin: gesperrt bis morgen 09:30.
  const night = musicWindowState(zone, daily(), new Date("2026-07-01T19:00:00Z"), TZ);
  assert.equal(night.allowed, false);
  assert.equal(night.until?.toISOString(), "2026-07-02T07:30:00.000Z");
});

test("Beschriftung des Musikfensters", () => {
  assert.equal(describeMusicWindow({ ...operating(-30, 30), musicMode: "MANUAL" }), null);
  assert.equal(describeMusicWindow(operating()), "Musik zur Betriebszeit");
  assert.equal(
    describeMusicWindow(operating(-30, 30)),
    "Musik von Betriebsbeginn −30 Min. bis Betriebsende +30 Min.",
  );
  assert.equal(
    describeMusicWindow(operating(0, -60)),
    "Musik von Betriebsbeginn bis Betriebsende −1 Std.",
  );
  assert.equal(
    describeMusicWindow(times(RESTAURANT)),
    "Musik Di–Fr 12:00–20:00 · Sa, So 10:00–20:00",
  );
});

test("Musikzeiten: ungültige, doppelte und leere Fenster fallen heraus", () => {
  assert.deepEqual(
    parseMusicTimes([
      { weekday: 2, from: "9:30", to: "18:00" },
      { weekday: 2, from: "10:00", to: "11:00" },
      { weekday: 0, from: "12:00", to: "12:00" },
      { weekday: 7, from: "10:00", to: "20:00" },
      { weekday: 1, from: "25:00", to: "20:00" },
      { weekday: 4, from: "18:00", to: "02:00" },
    ]),
    [
      { weekday: 2, from: "09:30", to: "18:00" },
      { weekday: 4, from: "18:00", to: "02:00" },
    ],
  );
  assert.deepEqual(parseMusicTimes("Unsinn"), []);
  assert.equal(
    formatMusicTimes([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, from: "10:00", to: "20:00" }))),
    "täglich 10:00–20:00",
  );
});

test("eigene Musikzeiten: an zur Startzeit, aus zur Endzeit, Ruhetag übersprungen", () => {
  const zone = times(RESTAURANT);
  // Sa 2026-10-10, 13:00 Berlin: an bis 20:00.
  const saturday = musicWindowState(zone, null, new Date("2026-10-10T11:00:00Z"), TZ);
  assert.equal(saturday.allowed, true);
  assert.equal(saturday.until?.toISOString(), "2026-10-10T18:00:00.000Z");
  // So 21:00: aus; Montag ist Ruhetag, also erst Di 12:00.
  const sunday = musicWindowState(zone, null, new Date("2026-10-11T19:00:00Z"), TZ);
  assert.equal(sunday.allowed, false);
  assert.equal(sunday.until?.toISOString(), "2026-10-13T10:00:00.000Z");
  // Eigene Zeiten hängen nicht an der Betriebszeit des Raums.
  assert.equal(musicWindowState(zone, daily(), new Date("2026-10-12T12:00:00Z"), TZ).allowed, false);
});

test("Zustand als Text, mit Warnung bei Betriebszeit ohne Saison", () => {
  const now = new Date("2026-10-10T11:00:00Z");
  assert.deepEqual(describeMusicState(times(RESTAURANT), null, now, TZ), {
    text: "Musik an bis heute 20:00",
    warn: false,
  });
  assert.deepEqual(describeMusicState(times(RESTAURANT), null, new Date("2026-10-10T19:00:00Z"), TZ), {
    text: "Musik aus bis morgen 10:00",
    warn: false,
  });
  const septemberOnly: ScheduleSpec = {
    name: "Gastronomie",
    seasons: [{ ...daily().seasons[0], startMmDd: "09-01", endMmDd: "09-30" }],
    exceptions: [],
  };
  assert.deepEqual(describeMusicState(operating(), septemberOnly, now, TZ), {
    text: "Musik aus – keine Musikzeit in den nächsten Tagen",
    warn: true,
  });
  assert.equal(describeMusicState({ ...operating(), musicMode: "MANUAL" }, daily(), now, TZ), null);
  assert.equal(describeMusicState(operating(), null, now, TZ)?.warn, true);
});

test("manuelles Play nach Feierabend gilt bis Mitternacht, nicht die ganze Nacht", () => {
  // Sa 14.11.2026, 16:20 Berlin (UTC+1) – Park hat um 20 Uhr zu, hier 21:00.
  const now = new Date("2026-11-14T20:00:00Z");
  const until = manualMusicOverrideUntil(operating(), daily(), now, TZ);
  assert.equal(until?.toISOString(), "2026-11-14T23:00:00.000Z");

  const zone = { ...operating(), musicOverrideUntil: until };
  const state = musicWindowState(zone, daily(), now, TZ);
  assert.deepEqual(state, { allowed: true, until, manual: true });
  assert.equal(describeMusicState(zone, daily(), now, TZ)?.text, "Musik manuell an bis morgen 00:00");

  // Nach Ablauf greift die Automatik wieder.
  const later = new Date("2026-11-14T23:30:00Z");
  assert.equal(musicWindowState(zone, daily(), later, TZ).allowed, false);
});

test("manuelles Play vor Betriebsbeginn gilt bis zum Fensterbeginn", () => {
  // 08:00 Berlin, Fenster öffnet um 10:00.
  const now = new Date("2026-11-14T07:00:00Z");
  const until = manualMusicOverrideUntil(operating(), daily(), now, TZ);
  assert.equal(until?.toISOString(), "2026-11-14T09:00:00.000Z");
});

test("im Musikfenster oder ohne Automatik braucht manuelles Play keinen Vorrang", () => {
  const inside = new Date("2026-11-14T12:00:00Z");
  assert.equal(manualMusicOverrideUntil(operating(), daily(), inside, TZ), null);
  assert.equal(manualMusicOverrideUntil({ ...operating(), musicMode: "MANUAL" }, daily(), inside, TZ), null);
  // Ein alter Vorrang ändert im Fenster nichts.
  const zone = { ...operating(), musicOverrideUntil: "2026-11-14T23:00:00.000Z" };
  assert.equal(musicWindowState(zone, daily(), inside, TZ).manual, undefined);
});
