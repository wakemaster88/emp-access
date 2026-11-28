import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestByHour } from "./chip-rules";
import type { SeasonSpec } from "./operating-hours";
import { areaOpenOn, closedServiceIds, profilesForArea, type OpeningProfile } from "./service-opening";

// Samstag, 28.11.2026, 12:07 Uhr in Berlin (Foto von der Kasse).
const NOW = new Date("2026-11-28T11:07:00Z");
const TODAY = "2026-11-28";

const allWeek = (opensAt: string, closesAt: string) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt, closesAt }));
const season = (name: string, startMmDd: string, endMmDd: string, periods: SeasonSpec["periods"]): SeasonSpec => ({ name, startMmDd, endMmDd, sortOrder: 0, periods });
const profile = (name: string, facilities: string[], seasons: SeasonSpec[], exceptions: OpeningProfile["spec"]["exceptions"] = []): OpeningProfile => ({
  name,
  facilities,
  spec: { name, seasons, exceptions },
});

// So wie in der Datenbank (vereinfacht): Wasserski im November nur Sa/So 12–16.
const PROFILES: OpeningProfile[] = [
  profile("Wasserski", ["Seilbahn A"], [
    season("Sommer", "05-01", "08-31", allWeek("10:00", "20:00")),
    season("November", "11-07", "11-30", [{ weekday: 5, opensAt: "12:00", closesAt: "16:00" }, { weekday: 6, opensAt: "12:00", closesAt: "16:00" }]),
  ]),
  profile("Bahnmiete Übungslift", ["Übungslift"], [season("Bis Herbstferien", "03-13", "11-06", allWeek("10:00", "18:00"))]),
  profile("Aquapark", [], [season("Sommer", "05-01", "09-30", allWeek("10:00", "19:00"))]),
  profile("Strandbad", [], [season("Sommer", "05-01", "09-30", allWeek("10:00", "20:00"))]),
];

// Services wie an der Kasse: Hauptressource plus Nebenbereiche.
const SERVICES = [
  { id: 2, mainAreaName: "Seilbahn A", areaNames: ["Seilbahn A", "Strandbad", "Insel"] }, // Öffentlicher Betrieb - 2 Stunden
  { id: 4, mainAreaName: null, areaNames: ["Strandbad"] }, // Strandbad - Tageskarte
  { id: 8, mainAreaName: "Übungslift", areaNames: ["Übungslift", "Strandbad", "Insel"] }, // Anfängerkurs - Übungslift
  { id: 10, mainAreaName: "Aquapark", areaNames: ["Aquapark", "Strandbad"] }, // Aquapark Tageskarte
  { id: 16, mainAreaName: null, areaNames: ["Event"] }, // Sommerkino: kein Profil
];

test("Profil zum Bereich: gleicher Name oder als Anlage belegt", () => {
  assert.deepEqual(profilesForArea("Seilbahn A", PROFILES).map((p) => p.name), ["Wasserski"]);
  assert.deepEqual(profilesForArea("Aquapark", PROFILES).map((p) => p.name), ["Aquapark"]);
  assert.deepEqual(profilesForArea("uebungslift", PROFILES).map((p) => p.name), ["Bahnmiete Übungslift"]);
  assert.deepEqual(profilesForArea("Event", PROFILES), []);
});

test("Bereich offen am Tag: Wasserski am Samstag ja, am Montag nein, Aquapark im Winter nein", () => {
  assert.equal(areaOpenOn("Seilbahn A", PROFILES, TODAY), true);
  assert.equal(areaOpenOn("Seilbahn A", PROFILES, "2026-11-23"), false);
  assert.equal(areaOpenOn("Aquapark", PROFILES, TODAY), false);
  assert.equal(areaOpenOn("Aquapark", PROFILES, "2026-07-15"), true);
  assert.equal(areaOpenOn("Event", PROFILES, TODAY), null);
});

test("Ausnahmetag öffnet einen sonst geschlossenen Bereich", () => {
  const nikolaus = [
    profile("Wasserski", ["Seilbahn A"], PROFILES[0].spec.seasons, [{ date: "2026-12-06", closed: false, opensAt: "12:00", closesAt: "16:00", note: "Nikolaus" }]),
  ];
  assert.equal(areaOpenOn("Seilbahn A", nikolaus, "2026-12-06"), true);
  assert.equal(areaOpenOn("Seilbahn A", nikolaus, "2026-12-05"), false);
});

test("Geschlossene Services: Hauptressource zählt, Nebenbereich Strandbad nicht, unbekannt bleibt drin", () => {
  assert.deepEqual([...closedServiceIds(SERVICES, PROFILES, TODAY)].sort((a, b) => a - b), [4, 8, 10]);
  assert.deepEqual([...closedServiceIds(SERVICES, PROFILES, "2026-07-15")], []);
  assert.deepEqual([...closedServiceIds(SERVICES, [], TODAY)], []);
});

test("Kasse 28.11. mittags: Wasserski statt Aquapark (Verkäufe aus dem Sommer überwiegen)", () => {
  // Zahlen aus dem letzten Jahr, 11–13 Uhr.
  const sales = [
    { serviceId: 10, hour: 11, count: 147 },
    { serviceId: 10, hour: 12, count: 104 },
    { serviceId: 10, hour: 13, count: 69 },
    { serviceId: 2, hour: 11, count: 47 },
    { serviceId: 2, hour: 12, count: 139 },
    { serviceId: 2, hour: 13, count: 118 },
    { serviceId: 8, hour: 12, count: 44 },
  ];
  const all = new Set(SERVICES.map((s) => s.id));
  assert.equal(suggestByHour(sales, all, NOW).serviceId, 10);
  const closed = closedServiceIds(SERVICES, PROFILES, TODAY);
  const open = new Set([...all].filter((id) => !closed.has(id)));
  const s = suggestByHour(sales, open, NOW);
  assert.equal(s.serviceId, 2);
  assert.deepEqual(s.frequent, []);
});
