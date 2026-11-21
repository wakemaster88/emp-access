import { test } from "node:test";
import assert from "node:assert/strict";
import { aboCategory, aboNamesRider, hasFollowUpAbo, isAdultAt, isKidsSubscriptionName, offerAtLogin, personDataKey, pickHolder, planPersons, riderDataEntered, riderView, withRiderView, type PlanTicket } from "./customer-person";

const NOW = new Date("2026-11-20T12:00:00Z");
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const PARENT = { firstName: "Eva", lastName: "Beispiel", birthDate: d("1984-03-02") };
const KID = { firstName: "Mia", lastName: "Beispiel", birthDate: d("2014-07-09") };

let next = 1;
function T(p: Partial<PlanTicket> & { start: string; end: string }): PlanTicket {
  const { start, end, ...rest } = p;
  const kids = rest.kids ?? false;
  return { id: next++, ...PARENT, startDate: d(start), endDate: d(end), kids, category: "ride", status: "VALID", riderProfileId: null, ...rest };
}

test("Hilfen: Alter, Kids-Abo, Vergleichsform", () => {
  assert.equal(isAdultAt(d("2008-11-21"), NOW), false);
  assert.equal(isAdultAt(d("2008-11-20"), NOW), true);
  assert.equal(isAdultAt(null, NOW), null);
  assert.equal(isKidsSubscriptionName("Kids Abo"), true);
  assert.equal(isKidsSubscriptionName("Kinder-Abo"), true);
  assert.equal(isKidsSubscriptionName("Ride Abo"), false);
  assert.equal(personDataKey({ firstName: "Eva", lastName: "Bei-spiel", birthDate: d("1984-03-02") }), "eva|beispiel|1984-03-02");
  assert.equal(personDataKey({ firstName: null, lastName: " ", birthDate: null }), "");
  assert.equal(aboNamesRider({ kids: true, birthDate: PARENT.birthDate, startDate: d("2026-05-01") }), false);
  assert.equal(aboNamesRider({ kids: true, birthDate: KID.birthDate, startDate: d("2026-05-01") }), true);
});

test("planPersons: ein Konto, Verlängerungen, eine neue Person", () => {
  const a = T({ start: "2024-05-01", end: "2025-04-30" });
  const b = T({ start: "2025-05-01", end: "2026-04-30" });
  const c = T({ start: "2026-04-15", end: "2027-04-14" });
  const plan = planPersons([c, a, b], [], NOW);
  assert.deepEqual(plan.open, []);
  assert.equal(plan.create.length, 1);
  assert.deepEqual(plan.create[0].ticketIds, [a.id, b.id, c.id]);
  assert.equal(plan.create[0].firstName, "Eva");
});

test("planPersons: Familienkonto, Kids-Abo mit Eltern-Daten bleibt offen", () => {
  const ride = T({ start: "2026-04-01", end: "2027-03-31" });
  const kids = T({ start: "2026-05-01", end: "2027-04-30", kids: true });
  const plan = planPersons([ride, kids], [], NOW);
  assert.deepEqual(plan.open, [kids.id]);
  assert.deepEqual(plan.create.map((c) => c.ticketIds), [[ride.id]]);
});

test("planPersons: zwei gleichzeitige Abos mit gleichen Daten, das zweite bleibt offen", () => {
  const ride = T({ start: "2026-04-01", end: "2027-03-31" });
  const beach = T({ start: "2026-05-01", end: "2027-04-30" });
  const plan = planPersons([ride, beach], [], NOW);
  assert.deepEqual(plan.open, [beach.id]);
  assert.deepEqual(plan.create[0].ticketIds, [ride.id]);
});

test("planPersons: Kind mit eigenen Daten wird eigene Person, Kids-Abo zuerst", () => {
  const ride = T({ start: "2026-04-01", end: "2027-03-31" });
  const kids = T({ ...KID, start: "2026-05-01", end: "2027-04-30", kids: true });
  const plan = planPersons([ride, kids], [], NOW);
  assert.deepEqual(plan.open, []);
  assert.deepEqual(plan.create.map((c) => c.firstName).sort(), ["Eva", "Mia"]);
});

test("planPersons: Wechsel von Kids auf Ride bleibt dieselbe Person", () => {
  const kids = T({ ...KID, start: "2025-05-01", end: "2026-04-30", kids: true });
  const ride = T({ ...KID, start: "2026-05-01", end: "2027-04-30" });
  const plan = planPersons([kids, ride], [], NOW);
  assert.equal(plan.create.length, 1);
  assert.deepEqual(plan.create[0].ticketIds.sort(), [kids.id, ride.id].sort());
});

test("planPersons: bestehende Person behält ihre Abos und bekommt die Verlängerung", () => {
  const old = T({ start: "2025-05-01", end: "2026-04-30", riderProfileId: 7 });
  const renew = T({ start: "2026-05-01", end: "2027-04-30" });
  const plan = planPersons([old, renew], [{ id: 7, firstName: null, lastName: null, birthDate: null }], NOW);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.assign, [{ personId: 7, ticketIds: [renew.id] }]);
});

test("planPersons: Abo einer fremden Person bleibt unberührt", () => {
  const foreign = T({ start: "2026-04-01", end: "2027-03-31", riderProfileId: 99 });
  const plan = planPersons([foreign], [], NOW);
  assert.deepEqual(plan, { create: [], assign: [], open: [] });
});

test("planPersons: Profil ohne Abo (App per E-Mail) übernimmt die neue Person", () => {
  const ride = T({ start: "2026-04-01", end: "2027-03-31" });
  const plan = planPersons([ride], [{ id: 5, firstName: null, lastName: null, birthDate: null }], NOW);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.assign, [{ personId: 5, ticketIds: [ride.id] }]);
});

test("planPersons: Abo ohne Namen bleibt offen", () => {
  const anon = T({ firstName: null, lastName: null, start: "2026-04-01", end: "2027-03-31" });
  assert.deepEqual(planPersons([anon], [], NOW).open, [anon.id]);
});

test("pickHolder: Kontoinhaber vor Kind, fremde Adresse scheidet aus, nur Kinder-Abos = kein Vorschlag", () => {
  const people = [
    { id: 1, email: null, firstName: "Mia", lastName: "Beispiel", adultAbo: false },
    { id: 2, email: null, firstName: "Eva", lastName: "Beispiel", adultAbo: true },
    { id: 3, email: "andere@example.de", firstName: "Eva", lastName: "Beispiel", adultAbo: true },
  ];
  assert.equal(pickHolder(people, "eva@example.de", "Eva Beispiel"), 2);
  assert.equal(pickHolder(people, "eva@example.de", null), 2);
  assert.equal(pickHolder([people[2]], "eva@example.de", "Eva Beispiel"), null);
  // Nur ein Kinder-Abo ohne den Namen des Inhabers: der Inhaber fährt selbst nicht.
  assert.equal(pickHolder([people[0]], "eva@example.de", "Eva Beispiel"), null);
  assert.equal(pickHolder([people[0]], "eva@example.de", "Mia Beispiel"), 1);
});

test("aboCategory: Fahr-Abos sind eine Art, Beach und Aqua je eine eigene", () => {
  assert.equal(aboCategory(2, "Ride Abo"), "ride");
  assert.equal(aboCategory(6, "Ride + Gear Abo"), "ride");
  assert.equal(aboCategory(5, "Kids Abo"), "ride");
  assert.equal(aboCategory(1, "Beach Abo"), "abo-1");
  assert.equal(aboCategory(4, "Aqua Abo"), "abo-4");
});

test("planPersons: Beach und Aqua gleichzeitig gehören derselben Person", () => {
  const beach = T({ start: "2026-10-26", end: "2027-06-26", category: "abo-1" });
  const aqua = T({ start: "2026-10-26", end: "2027-05-26", category: "abo-4" });
  const plan = planPersons([beach, aqua], [], NOW);
  assert.deepEqual(plan.open, []);
  assert.deepEqual(plan.create.map((c) => c.ticketIds.sort()), [[beach.id, aqua.id].sort()]);
});

test("planPersons: gekündigtes Abo neben dem neuen zählt nicht als zweite Person", () => {
  const canceled = T({ start: "2026-10-26", end: "2028-10-26", category: "abo-4", status: "CANCELED" });
  const fresh = T({ start: "2026-10-31", end: "2028-10-31", category: "abo-4" });
  const plan = planPersons([canceled, fresh], [], NOW);
  assert.deepEqual(plan.open, []);
  assert.equal(plan.create.length, 1);
});

test("riderView: Person mit Namen geht vor, sonst Daten am Ticket", () => {
  const base = { firstName: "Eva", lastName: "Muster", birthDate: d("1981-03-04"), subscriptionId: 5, customerId: 7 };
  const kid = riderView({ ...base, riderProfileId: 3, riderProfile: { firstName: "Mia", lastName: "Muster", birthDate: d("2014-06-01") } });
  assert.deepEqual([kid.firstName, kid.birthDate?.toISOString().slice(0, 10), kid.riderOpen], ["Mia", "2014-06-01", false]);
  const empty = riderView({ ...base, riderProfileId: 3, riderProfile: { firstName: null, lastName: " ", birthDate: null } });
  assert.equal(empty.firstName, "Eva");
  const open = riderView({ ...base, riderProfileId: null });
  assert.equal(open.riderOpen, true);
  assert.equal(riderView({ ...base, customerId: null, riderProfileId: null }).riderOpen, false);
  assert.equal(riderView({ ...base, subscriptionId: null, riderProfileId: null }).riderOpen, false);
  const t = withRiderView({ id: 1, ...base, riderProfileId: 3, riderProfile: { firstName: "Mia", lastName: null, birthDate: null } });
  assert.equal("riderProfile" in t, false);
  assert.equal(t.firstName, "Mia");
});

test("riderDataEntered: nur neue Daten zählen", () => {
  const ticket = { firstName: "Eva", lastName: "Muster", birthDate: d("1981-03-04") };
  assert.equal(riderDataEntered(ticket, { ...ticket }), false);
  assert.equal(riderDataEntered(ticket, { firstName: " eva ", lastName: "MUSTER", birthDate: d("1981-03-04") }), false);
  assert.equal(riderDataEntered(ticket, { firstName: "Mia", lastName: "Muster", birthDate: d("2014-06-01") }), true);
  assert.equal(riderDataEntered(ticket, { firstName: "", lastName: null, birthDate: d("2014-06-01") }), false);
});

test("hasFollowUpAbo: Verlängerung derselben Art zählt, andere Art und kürzere nicht", () => {
  const d = (v: string) => new Date(`${v}T12:00:00Z`);
  const abo = { id: 1, category: "ride", endDate: d("2026-11-30") };
  assert.equal(hasFollowUpAbo(abo, [abo]), false);
  assert.equal(hasFollowUpAbo(abo, [abo, { id: 2, category: "ride", endDate: d("2027-11-30") }]), true);
  assert.equal(hasFollowUpAbo(abo, [{ id: 2, category: "ride", endDate: null }]), true);
  assert.equal(hasFollowUpAbo(abo, [{ id: 3, category: "abo-7", endDate: d("2027-11-30") }]), false);
  assert.equal(hasFollowUpAbo(abo, [{ id: 4, category: "ride", endDate: d("2026-10-01") }]), false);
  assert.equal(hasFollowUpAbo({ ...abo, endDate: null }, [{ id: 2, category: "ride", endDate: null }]), false);
});

test("planPersons: Name in der App geändert, Verlängerung mit altem Namen findet die Person", () => {
  const old = T({ start: "2025-05-01", end: "2026-04-30", firstName: "Eav", riderProfileId: 7 });
  const renewal = T({ start: "2026-05-01", end: "2027-04-30", firstName: "Eav" });
  const plan = planPersons([old, renewal], [{ id: 7, ...PARENT }], NOW);
  assert.deepEqual(plan.open, []);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.assign, [{ personId: 7, ticketIds: [renewal.id] }]);
});

test("planPersons: genaue Daten gehen vor früheren Daten einer anderen Person", () => {
  const old = T({ start: "2025-05-01", end: "2026-04-30", riderProfileId: 7 });
  const renewal = T({ start: "2026-05-01", end: "2027-04-30" });
  // Person 7 heißt inzwischen anders, Person 8 trägt die Daten am Abo.
  const plan = planPersons([old, renewal], [{ id: 7, ...PARENT, firstName: "Evi" }, { id: 8, ...PARENT }], NOW);
  assert.deepEqual(plan.assign, [{ personId: 8, ticketIds: [renewal.id] }]);
});

test("offerAtLogin: ohne Zugang immer, mit Zugang nur der Kontoinhaber", () => {
  const aaron = { firstName: "Aaron", lastName: "Armborst", hasAccess: true };
  // Passkey über den App-Link, Adresse noch nie bestätigt: der Kontoinhaber selbst.
  assert.equal(offerAtLogin(aaron, "Aaron Armborst"), true);
  assert.equal(offerAtLogin(aaron, "aaron  ARMBORST"), true);
  // Anderes Familienmitglied mit eigenem Zugang: nicht übernehmen.
  assert.equal(offerAtLogin({ firstName: "Eva", lastName: "Armborst", hasAccess: true }, "Aaron Armborst"), false);
  assert.equal(offerAtLogin(aaron, null), false);
  assert.equal(offerAtLogin({ firstName: "Eva", lastName: "Armborst", hasAccess: false }, "Aaron Armborst"), true);
});
