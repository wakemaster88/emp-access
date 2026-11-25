import { test } from "node:test";
import assert from "node:assert/strict";

const P = (id: number, familyId: number | null, familyAdult: boolean, accountId = 1) => ({ id, accountId, familyId, familyAdult });

test("familyRelation: Erwachsene verwalten Kinder und sehen den Partner", async () => {
  const { familyRelation } = await import("./rider-family");
  const mama = P(1, 7, true), papa = P(2, 7, true), kind = P(3, 7, false);
  assert.equal(familyRelation(mama, mama), "self");
  assert.equal(familyRelation(mama, kind), "manage");
  assert.equal(familyRelation(mama, papa), "view");
  assert.equal(familyRelation(papa, mama), "view");
});

test("familyRelation: Kinder und Fremde sehen niemanden", async () => {
  const { familyRelation } = await import("./rider-family");
  const mama = P(1, 7, true), kind = P(3, 7, false), kind2 = P(4, 7, false);
  assert.equal(familyRelation(kind, mama), null);
  assert.equal(familyRelation(kind, kind2), null);
  assert.equal(familyRelation(kind, kind), "self");
  assert.equal(familyRelation(null, kind), null);
  assert.equal(familyRelation(P(9, 8, true), kind), null);
  assert.equal(familyRelation(P(9, null, false), P(3, null, false)), null);
  // Gleiche Familien-ID in einem anderen Konto zählt nicht.
  assert.equal(familyRelation(P(9, 7, true, 2), kind), null);
});

test("familyInviteKey: gilt sieben Tage und lässt sich nicht fälschen", async () => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  const { FAMILY_INVITE_DAYS, familyInviteKey, verifyFamilyInviteKey } = await import("./rider-family");
  const now = new Date("2026-11-15T12:00:00Z");
  const key = familyInviteKey(7, 1, now);
  assert.deepEqual(verifyFamilyInviteKey(key, now), { familyId: 7, inviterId: 1 });
  assert.equal(verifyFamilyInviteKey(key, new Date(now.getTime() + FAMILY_INVITE_DAYS * 86_400_000 + 1000)), null);
  assert.equal(verifyFamilyInviteKey(key.replace(/^7\./, "8."), now), null);
  assert.equal(verifyFamilyInviteKey(key.slice(0, -1) + (key.endsWith("A") ? "B" : "A"), now), null);
  assert.equal(verifyFamilyInviteKey("", now), null);
});

test("memberName: Vorname der Person, sonst vom Abo, sonst Spitzname", async () => {
  const { memberName } = await import("./rider-family");
  const t = (firstName: string | null, name: string, subscriptionId: number | null) => ({ firstName, name, endDate: null, subscriptionId });
  assert.equal(memberName({ nickname: "Wave", tickets: [t(null, "Tagesticket", null), t("Mia", "Mia Muster", 2)] }), "Mia");
  assert.equal(memberName({ nickname: "Wave", tickets: [t(null, "Tagesticket", null)] }), "Wave");
  assert.equal(memberName({ nickname: null, tickets: [t(null, "Tagesticket", null)] }), "Tagesticket");
  assert.equal(memberName({ nickname: null, tickets: [] }), "Mitglied");
  // Am Kids-Abo steht bei anny der Name der Eltern: der Vorname der Person gewinnt.
  assert.equal(memberName({ firstName: "Mia", nickname: null, tickets: [t("Eva", "Eva Muster", 2)] }), "Mia");
});

test("familyInviteKey: Version im Schlüssel, alter Schlüssel nur beim Zählerstand 0", async () => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  const { familyInviteKey, inviteVersionMatches, verifyFamilyInviteKey } = await import("./rider-family");
  const now = new Date("2026-11-25T12:00:00Z");
  const key = familyInviteKey(7, 1, now, 3);
  assert.deepEqual(verifyFamilyInviteKey(key, now), { familyId: 7, inviterId: 1, version: 3 });
  assert.equal(verifyFamilyInviteKey(key.replace(".3.", ".4."), now), null);
  const legacy = familyInviteKey(7, 1, now);
  assert.deepEqual(verifyFamilyInviteKey(legacy, now), { familyId: 7, inviterId: 1 });

  assert.equal(inviteVersionMatches(3, 3), true);
  assert.equal(inviteVersionMatches(2, 3), false);
  assert.equal(inviteVersionMatches(undefined, 0), true);
  assert.equal(inviteVersionMatches(undefined, 1), false);
  assert.equal(inviteVersionMatches(0, 0), true);
});

test("childrenLeavingWith: Kinder aus dem eigenen Kundenkonto gehen mit", async () => {
  const { childrenLeavingWith } = await import("./rider-family");
  const me = { id: 1, customerId: 50 };
  const members = [
    { id: 1, familyAdult: true, customerId: 50 },
    { id: 2, familyAdult: true, customerId: 60 },
    { id: 3, familyAdult: false, customerId: 50 },
    { id: 4, familyAdult: false, customerId: 60 },
    { id: 5, familyAdult: false, customerId: null },
  ];
  assert.deepEqual(childrenLeavingWith(me, members), [3]);
  // Ohne Kundenkonto nimmt niemand Kinder mit.
  assert.deepEqual(childrenLeavingWith({ id: 1, customerId: null }, members), []);
  // Gehört eine weitere Erwachsene zum selben Konto, bleiben die Kinder.
  assert.deepEqual(childrenLeavingWith(me, [...members, { id: 6, familyAdult: true, customerId: 50 }]), []);
});
