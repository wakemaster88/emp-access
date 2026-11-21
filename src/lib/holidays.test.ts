import assert from "node:assert/strict";
import { test } from "node:test";
import { HOLIDAY_BY_KEY, currentHoliday, easterSunday, holidayDate, upcomingHolidays } from "./holidays";
import { holidaySchema, normalizeHoliday } from "./gamification-input";

const def = (key: string) => HOLIDAY_BY_KEY.get(key)!;

test("Ostersonntag stimmt für bekannte Jahre", () => {
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2038), "2038-04-25");
});

test("bewegliche Feiertage NRW 2027", () => {
  assert.equal(holidayDate(def("karfreitag"), 2027), "2027-03-26");
  assert.equal(holidayDate(def("ostermontag"), 2027), "2027-03-29");
  assert.equal(holidayDate(def("christi-himmelfahrt"), 2027), "2027-05-06");
  assert.equal(holidayDate(def("pfingstmontag"), 2027), "2027-05-17");
  assert.equal(holidayDate(def("fronleichnam"), 2027), "2027-05-27");
});

test("nächste 12 Monate: sortiert, jeder Feiertag einmal", () => {
  const list = upcomingHolidays("2026-11-21");
  assert.equal(list[0].key, "heiligabend");
  assert.equal(list.length, 15);
  assert.equal(new Set(list.map((h) => h.key)).size, 15);
  assert.equal(list.at(-1)!.key, "allerheiligen");
  assert.equal(list.at(-1)!.ymd, "2027-11-01");
});

test("currentHoliday: nur im Zeitraum und nur eingeschaltet", () => {
  const s = [{ key: "ostermontag", active: true, daysBefore: 2 }];
  assert.equal(currentHoliday(s, "2027-03-26"), null);
  assert.equal(currentHoliday(s, "2027-03-27")?.ymd, "2027-03-29");
  assert.equal(currentHoliday(s, "2027-03-29")?.ymd, "2027-03-29");
  assert.equal(currentHoliday(s, "2027-03-30"), null);
  assert.equal(currentHoliday([{ ...s[0], active: false }], "2027-03-29"), null);
});

test("currentHoliday: der nächstliegende gewinnt, Neujahr über den Jahreswechsel", () => {
  const s = [
    { key: "heiligabend", active: true, daysBefore: 0 },
    { key: "weihnachten-1", active: true, daysBefore: 7 },
    { key: "neujahr", active: true, daysBefore: 3 },
  ];
  assert.equal(currentHoliday(s, "2026-12-24")?.setting.key, "heiligabend");
  assert.equal(currentHoliday(s, "2026-12-25")?.setting.key, "weihnachten-1");
  const ny = currentHoliday(s, "2026-12-30");
  assert.equal(ny?.setting.key, "neujahr");
  assert.equal(ny?.year, 2027);
  assert.equal(currentHoliday([{ key: "unbekannt", active: true, daysBefore: 0 }], "2026-12-24"), null);
});

test("Eingabe: Angebot braucht Text, Gutschein braucht Leistung", () => {
  const base = { title: null, text: null, voucherLabel: null, voucherValidDays: null, daysBefore: 0, active: true };
  assert.equal(holidaySchema.safeParse({ ...base, show: "GREETING" }).success, true);
  assert.equal(holidaySchema.safeParse({ ...base, show: "OFFER" }).success, false);
  assert.equal(holidaySchema.safeParse({ ...base, show: "VOUCHER" }).success, false);
  assert.equal(holidaySchema.safeParse({ ...base, show: "GREETING", daysBefore: 15 }).success, false);
  const n = normalizeHoliday({ ...base, show: "GREETING", voucherLabel: "Freigetränk", voucherValidDays: 30, title: "" });
  assert.equal(n.voucherLabel, null);
  assert.equal(n.voucherValidDays, null);
  assert.equal(n.title, null);
});

test("Push am Feiertag: einmal je Jahr, ab dem ersten Anzeigetag, nur tagsüber", async () => {
  const { holidayAnnounceBlock, holidayPushText } = await import("./rider-announce-rules");
  const h = { key: "heiligabend", active: true, daysBefore: 2, pushPlanned: true, pushedYear: null };
  assert.equal(holidayAnnounceBlock(h, "2026-12-21", 10), "not-yet");
  assert.equal(holidayAnnounceBlock(h, "2026-12-22", 8), "night");
  assert.equal(holidayAnnounceBlock(h, "2026-12-22", 9), null);
  assert.equal(holidayAnnounceBlock({ ...h, pushedYear: 2026 }, "2026-12-23", 10), "sent");
  assert.equal(holidayAnnounceBlock({ ...h, pushedYear: 2025 }, "2026-12-23", 10), null);
  assert.equal(holidayAnnounceBlock({ ...h, pushPlanned: false }, "2026-12-24", 10), "not-planned");
  assert.equal(holidayAnnounceBlock({ ...h, active: false }, "2026-12-24", 10), "off");

  const v = holidayPushText({ key: "heiligabend", show: "VOUCHER", title: null, text: "Danke für die Saison", voucherLabel: "Heißgetränk" });
  assert.equal(v.title, "Frohe Weihnachten");
  assert.equal(v.body, "Danke für die Saison. Mit Abo wartet ein Geschenk in der App: Heißgetränk.");
  assert.equal(holidayPushText({ key: "silvester", show: "GREETING", title: "", text: null, voucherLabel: null }).body, "Schau in der App vorbei.");
});
