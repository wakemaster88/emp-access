import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageOn,
  birthdayAnnounceText,
  birthdayInYear,
  birthdayPushBlock,
  birthdayPushText,
  birthdayTitle,
  fillName,
  isBirthdayOn,
  parseBirthdayZoneIds,
} from "./birthday";
import { birthdayAnnounceSchema, normalizeBirthday } from "./gamification-input";

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
