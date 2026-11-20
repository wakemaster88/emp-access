import { test } from "node:test";
import assert from "node:assert/strict";

test("familyChildKey: gilt 7 Tage, nur unverändert und mit Geheimnis", async () => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  const { familyChildKey, verifyFamilyChildKey } = await import("./rider-family-link");
  const now = new Date("2026-11-20T12:00:00Z");
  const key = familyChildKey(12, 34, now);
  assert.deepEqual(verifyFamilyChildKey(key, now), { inviterId: 12, customerId: 34 });
  assert.deepEqual(verifyFamilyChildKey(key, new Date("2026-11-27T11:59:00Z")), { inviterId: 12, customerId: 34 });
  assert.equal(verifyFamilyChildKey(key, new Date("2026-11-27T12:00:01Z")), null);
  // anderes Konto eingesetzt
  const [, , exp, sig] = key.split(".");
  assert.equal(verifyFamilyChildKey(`12.35.${exp}.${sig}`, now), null);
  // Schlüssel der Partner-Einladung taugt hier nicht
  const { familyInviteKey } = await import("./rider-family");
  assert.equal(verifyFamilyChildKey(familyInviteKey(12, 34, now), now), null);
  process.env.AUTH_SECRET = "";
  assert.equal(verifyFamilyChildKey(key, now), null);
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
});

test("childCandidates: nur Kinder ohne Familie oder schon in dieser, Volljährige nicht", async () => {
  const { childCandidates } = await import("./rider-family-link");
  const now = new Date("2026-11-20T12:00:00Z");
  const row = (id: number, birth: string | null, familyId: number | null, visible = true) => ({
    id, name: `P${id}`, birthDate: birth ? new Date(`${birth}T00:00:00Z`) : null, familyId, visible,
  });
  const rows = [
    row(1, "2012-05-01", null), // Kind, frei
    row(2, "2000-01-01", null), // erwachsen
    row(3, null, null), // ohne Geburtsdatum
    row(4, "2014-03-03", 9), // schon in dieser Familie
    row(5, "2015-03-03", 8), // in einer anderen Familie
    row(6, "2016-01-01", null, false), // ohne Abo und Adresse
  ];
  assert.deepEqual(childCandidates(rows, 9, now), [
    { id: 1, name: "P1", joined: false },
    { id: 3, name: "P3", joined: false },
    { id: 4, name: "P4", joined: true },
  ]);
  assert.deepEqual(childCandidates(rows, null, now).map((c) => c.id), [1, 3]);
});
