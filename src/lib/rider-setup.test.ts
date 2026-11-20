import { test } from "node:test";
import assert from "node:assert/strict";

test("aboSentence: läuft, lief, ohne Ende, ohne Abo", async () => {
  const { aboSentence } = await import("./rider-setup");
  const now = new Date("2026-11-20T12:00:00Z");
  assert.equal(aboSentence({ name: "Ride Abo", endDate: new Date("2027-02-28T00:00:00Z") }, "Dein", now), "Dein Ride Abo läuft bis 28.02.2027.");
  assert.equal(aboSentence({ name: "Kids Abo", endDate: new Date("2026-09-30T00:00:00Z") }, "Jonas’", now), "Jonas’ Kids Abo lief bis 30.09.2026.");
  assert.equal(aboSentence({ name: "Ride Abo", endDate: null }, "Linas", now), "Linas Ride Abo läuft ohne Enddatum.");
  assert.equal(aboSentence(null, "Dein", now), null);
});
