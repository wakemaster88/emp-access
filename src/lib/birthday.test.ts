import assert from "node:assert/strict";
import { test } from "node:test";
import {
  birthdayBedUntil,
  isBuiltinBirthdayMusic,
  ttsSeconds,
  ageOn,
  birthdayAnnounceText,
  birthdayInYear,
  birthdayPushBlock,
  birthdayPushText,
  birthdayTitle,
  fillName,
  isBirthdayOn,
  parseBirthdayZoneIds,
  birthdaySongZones,
} from "./birthday";
import { birthdayAnnounceSchema, birthdaySongSchema, normalizeBirthday } from "./gamification-input";

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

test("Geburtstag am selben Tag im Jahr, nicht am Tag der Geburt", () => {
  assert.equal(isBirthdayOn(d("1990-11-21"), "2026-11-21"), true);
  assert.equal(isBirthdayOn(d("1990-11-21"), "2026-11-22"), false);
  assert.equal(isBirthdayOn(d("2026-11-21"), "2026-11-21"), false);
  assert.equal(isBirthdayOn(null, "2026-11-21"), false);
  assert.equal(ageOn(d("1990-11-21"), "2026-11-21"), 36);
});

test("29. Februar feiert ohne Schalttag am 28.", () => {
  assert.equal(birthdayInYear(d("2000-02-29"), 2027), "2027-02-28");
  assert.equal(birthdayInYear(d("2000-02-29"), 2028), "2028-02-29");
  assert.equal(isBirthdayOn(d("2000-02-29"), "2027-02-28"), true);
  assert.equal(isBirthdayOn(d("2000-02-28"), "2028-02-29"), false);
});

test("Vorname einsetzen oder samt Komma weglassen", () => {
  assert.equal(fillName("Alles Gute, {vorname}!", "Mia"), "Alles Gute, Mia!");
  assert.equal(fillName("Alles Gute, {vorname}!", null), "Alles Gute!");
  assert.equal(fillName("Alles Gute {Vorname} und viel Spaß", null), "Alles Gute und viel Spaß");
  assert.equal(birthdayTitle(null, "Mia"), "Alles Gute zum Geburtstag, Mia");
  assert.equal(birthdayTitle("Happy Birthday {vorname}", "Mia"), "Happy Birthday Mia");
  assert.equal(birthdayTitle(null, null), "Alles Gute zum Geburtstag");
});

test("Durchsage nennt den Vornamen nur, wenn eingeschaltet", () => {
  const on = birthdayAnnounceText({ announceText: null, announceName: true }, "Mia");
  assert.match(on, /^Herzlichen Glückwunsch zum Geburtstag, Mia!/);
  const off = birthdayAnnounceText({ announceText: null, announceName: false }, "Mia");
  assert.match(off, /^Herzlichen Glückwunsch zum Geburtstag! /);
  assert.ok(!off.includes("Mia"));
});

test("Push: eigenes Gerät, Eltern, Geschenk", () => {
  const s = { title: null, text: null, voucherLabel: "Freifahrt" };
  assert.deepEqual(birthdayPushText(s, "Mia"), {
    title: "Alles Gute zum Geburtstag, Mia",
    body: "In der App wartet ein Geschenk: Freifahrt.",
  });
  assert.equal(birthdayPushText(s, "Mia", true).title, "Heute hat Mia Geburtstag");
  assert.equal(birthdayPushText({ ...s, voucherLabel: null }, null).body, "Wir wünschen dir einen tollen Tag.");
});

test("Push-Sperren: aus, nicht geplant, TEST:", () => {
  assert.equal(birthdayPushBlock({ active: true, pushPlanned: true, title: null }), null);
  assert.equal(birthdayPushBlock({ active: true, pushPlanned: false, title: null }), "not-planned");
  assert.equal(birthdayPushBlock({ active: false, pushPlanned: true, title: null }), "off");
  assert.equal(birthdayPushBlock({ active: true, pushPlanned: true, title: "TEST: Gruß" }), "test");
});

test("Eingaben: Zonen nötig, Gültigkeit nur mit Geschenk", () => {
  assert.deepEqual(parseBirthdayZoneIds([1, 1, "2", -3, 4]), [1, 4]);
  const ann = { announceActive: true, announceText: null, announceName: true, announceZoneIds: [], announceVoice: null, announceChime: true };
  assert.equal(birthdayAnnounceSchema.safeParse(ann).success, false);
  assert.equal(birthdayAnnounceSchema.safeParse({ ...ann, announceZoneIds: [1] }).success, true);
  const n = normalizeBirthday({ active: true, title: "", text: null, voucherLabel: "", voucherValidDays: 30, push: true });
  assert.equal(n.voucherLabel, null);
  assert.equal(n.voucherValidDays, null);
  assert.equal(n.title, null);
});

test("Dauer der Sprachausgabe aus der Dateigröße (128 kbit/s)", () => {
  assert.equal(ttsSeconds({ durationSec: null, sizeBytes: 112_000 }), 7);
  assert.equal(ttsSeconds({ durationSec: 9, sizeBytes: 112_000 }), 9);
  assert.equal(ttsSeconds({ durationSec: null, sizeBytes: null }), null);
});

test("Musik unter der Ansage endet 10 s nach ihr, höchstens mit dem Titel", () => {
  assert.equal(birthdayBedUntil(7, null), 18.5);
  assert.equal(birthdayBedUntil(7, 200), 18.5);
  assert.equal(birthdayBedUntil(7, 15), 15);
  // Ein kurzer Titel kürzt nie die Ansage selbst.
  assert.equal(birthdayBedUntil(12, 10), 14);
  assert.equal(birthdayBedUntil(null, null), 19.5);
});

test("erkennt den mitgelieferten Happy-Birthday-Titel", () => {
  assert.equal(isBuiltinBirthdayMusic("https://x.de/audio/geburtstag/happy-birthday.mp3"), true);
  assert.equal(isBuiltinBirthdayMusic("https://blob/audio/song.mp3"), false);
});

test("Musik-Auswahl im Schema", () => {
  const base = { announceActive: true, announceText: null, announceName: true, announceZoneIds: [1], announceVoice: null, announceChime: true };
  assert.equal(birthdayAnnounceSchema.safeParse({ ...base, announceMusic: "builtin" }).success, true);
  assert.equal(birthdayAnnounceSchema.safeParse({ ...base, announceMusic: 5 }).success, true);
  assert.equal(birthdayAnnounceSchema.safeParse({ ...base, announceMusic: null }).success, true);
  assert.equal(birthdayAnnounceSchema.safeParse({ ...base, announceMusic: "x" }).success, false);
});

test("spokenName: nur Buchstaben, Leerzeichen, Bindestrich und Apostroph, höchstens 40 Zeichen", async () => {
  const { spokenName, SPOKEN_NAME_MAX } = await import("./birthday");
  assert.equal(spokenName("Jörg"), "Jörg");
  assert.equal(spokenName("Anna-Lena"), "Anna-Lena");
  assert.equal(spokenName("O’Brien"), "O’Brien");
  assert.equal(spokenName("D'Angelo"), "D'Angelo");
  assert.equal(spokenName("Zoë  Marie"), "Zoë Marie");
  assert.equal(spokenName("Mia2!"), "Mia");
  assert.equal(spokenName("Mäx"), "Mäx");
  assert.equal(spokenName("Lea, bitte zur Kasse: 0815"), "Lea bitte zur Kasse");
  assert.equal(spokenName("1234"), null);
  assert.equal(spokenName("--"), null);
  assert.equal(spokenName(null), null);
  assert.equal(spokenName("a".repeat(60))?.length, SPOKEN_NAME_MAX);
});

test("birthdayAnnounceText: Name nur gereinigt in der Durchsage", async () => {
  const { birthdayAnnounceText } = await import("./birthday");
  assert.equal(
    birthdayAnnounceText({ announceText: "Alles Gute, {vorname}!", announceName: true }, "Mia <3"),
    "Alles Gute, Mia!",
  );
  assert.equal(birthdayAnnounceText({ announceText: "Alles Gute, {vorname}!", announceName: true }, "123"), "Alles Gute!");
});

test("birthdaySongZones: Song im Shop nur am Geburtstag, einmal eingestellt", () => {
  // Aaron, geboren 28.11.1988, scannt am 28.11.2026 am Shop-Monitor; Zone 5 = Shop.
  const settings = { monitorSongActive: true, monitorSongZoneIds: [5], monitorSongTrackId: 46 };
  const aaron = { birthDate: d("1988-11-28"), birthdayAnnounce: true };
  assert.deepEqual(birthdaySongZones(settings, aaron, "2026-11-28"), [5]);
  // Am Tag davor und danach nicht.
  assert.deepEqual(birthdaySongZones(settings, aaron, "2026-11-27"), []);
  assert.deepEqual(birthdaySongZones(settings, aaron, "2026-11-29"), []);
  // Durchsage in der App abgeschaltet: auch kein Song.
  assert.deepEqual(birthdaySongZones(settings, { ...aaron, birthdayAnnounce: false }, "2026-11-28"), []);
  // Aus, ohne Song oder ohne Zone: nichts.
  assert.deepEqual(birthdaySongZones({ ...settings, monitorSongActive: false }, aaron, "2026-11-28"), []);
  assert.deepEqual(birthdaySongZones({ ...settings, monitorSongTrackId: null }, aaron, "2026-11-28"), []);
  assert.deepEqual(birthdaySongZones({ ...settings, monitorSongZoneIds: [] }, aaron, "2026-11-28"), []);
  // Ohne Geburtsdatum oder ohne Einstellung: nichts.
  assert.deepEqual(birthdaySongZones(settings, { birthDate: null, birthdayAnnounce: true }, "2026-11-28"), []);
  assert.deepEqual(birthdaySongZones(null, aaron, "2026-11-28"), []);
});

test("birthdaySongSchema: an nur mit Zone und Song", () => {
  assert.equal(birthdaySongSchema.safeParse({ monitorSongActive: true, monitorSongZoneIds: [5], monitorSong: "builtin" }).success, true);
  assert.equal(birthdaySongSchema.safeParse({ monitorSongActive: true, monitorSongZoneIds: [5], monitorSong: 46 }).success, true);
  assert.equal(birthdaySongSchema.safeParse({ monitorSongActive: true, monitorSongZoneIds: [], monitorSong: 46 }).success, false);
  assert.equal(birthdaySongSchema.safeParse({ monitorSongActive: true, monitorSongZoneIds: [5], monitorSong: null }).success, false);
  // Aus darf leer sein.
  assert.equal(birthdaySongSchema.safeParse({ monitorSongActive: false, monitorSongZoneIds: [], monitorSong: null }).success, true);
});
