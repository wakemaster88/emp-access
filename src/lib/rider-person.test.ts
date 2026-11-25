import { test } from "node:test";
import assert from "node:assert/strict";
import { initials, parsePersonInput, PHOTO_MAX_CHARS, riderPhotoUrl } from "./rider-person";

const NOW = new Date("2026-11-20T12:00:00Z");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("parsePersonInput: Namen werden bereinigt, Geburtsdatum wird geprüft", () => {
  const ok = parsePersonInput({ firstName: "  Eva ", lastName: "van  der Berg", birthDate: "1984-03-02" }, NOW);
  assert.ok("data" in ok);
  assert.equal(ok.data.firstName, "Eva");
  assert.equal(ok.data.lastName, "van der Berg");
  assert.equal(ok.data.birthDate?.toISOString(), "1984-03-02T00:00:00.000Z");
  assert.equal("photo" in ok.data, false);

  assert.ok("data" in parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: null }, NOW));
  assert.ok("error" in parsePersonInput({ firstName: "Eva", lastName: " ", birthDate: null }, NOW));
  assert.ok("error" in parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: "2026-02-31" }, NOW));
  assert.ok("error" in parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: "2027-01-01" }, NOW));
  assert.ok("error" in parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: "1899-12-31" }, NOW));
  assert.ok("error" in parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: "02.03.1984" }, NOW));
});

test("parsePersonInput: Profilbild setzen, entfernen, ablehnen", () => {
  const set = parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: null, photo: PNG }, NOW);
  assert.ok("data" in set && set.data.photo === PNG);
  const removed = parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: null, photo: null }, NOW);
  assert.ok("data" in removed && removed.data.photo === null);
  const onlyPhoto = parsePersonInput({ photo: PNG }, NOW);
  assert.ok("data" in onlyPhoto);
  assert.deepEqual(Object.keys(onlyPhoto.data), ["photo"]);
  assert.ok("error" in parsePersonInput({}, NOW));
  assert.ok("error" in parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: null, photo: "https://example.org/a.png" }, NOW));
  assert.ok("error" in parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: null, photo: "data:image/svg+xml;base64,PHN2Zz4=" }, NOW));
  assert.ok("error" in parsePersonInput({ firstName: "Eva", lastName: "B", birthDate: null, photo: PNG + "A".repeat(PHOTO_MAX_CHARS) }, NOW));
});

test("initials", () => {
  assert.equal(initials("eva", "Beispiel"), "EB");
  assert.equal(initials("Eva", null), "E");
  assert.equal(initials(" ", ""), "?");
});

test("riderPhotoUrl: eigene Route je Person, Version aus updatedAt", () => {
  const at = new Date("2026-11-24T10:00:00Z");
  assert.equal(riderPhotoUrl("abcdefghijklmnop", at), `/api/rider/abcdefghijklmnop/person/photo?v=${at.getTime()}`);
  // Token mit Sonderzeichen landet sicher im Pfad.
  assert.equal(riderPhotoUrl("ab/cd?ef", at), `/api/rider/ab%2Fcd%3Fef/person/photo?v=${at.getTime()}`);
  // Neues Bild, neues updatedAt: neue Adresse, der Browser holt es neu.
  assert.notEqual(riderPhotoUrl("abcdefghijklmnop", at), riderPhotoUrl("abcdefghijklmnop", new Date(at.getTime() + 1)));
});

test("birthDateChange: erstes Eintragen immer, danach eine Änderung im Jahr", async () => {
  const { birthDateChange, birthDateLocked, BIRTH_DATE_LOCK_DAYS } = await import("./rider-person");
  const a = new Date(Date.UTC(1990, 4, 1));
  const b = new Date(Date.UTC(1990, 4, 2));
  const day = 86_400_000;
  assert.equal(birthDateChange(a, new Date(a.getTime()), null, NOW), "same");
  assert.equal(birthDateChange(null, null, null, NOW), "same");
  assert.equal(birthDateChange(null, a, null, NOW), "first");
  assert.equal(birthDateChange(a, b, null, NOW), "change");
  assert.equal(birthDateChange(a, null, null, NOW), "change");
  const recent = new Date(NOW.getTime() - 10 * day);
  assert.equal(birthDateChange(a, b, recent, NOW), "blocked");
  // Gelöscht und neu eingetragen zählt nicht als erstes Mal.
  assert.equal(birthDateChange(null, b, recent, NOW), "blocked");
  assert.equal(birthDateChange(a, a, recent, NOW), "same");
  const old = new Date(NOW.getTime() - (BIRTH_DATE_LOCK_DAYS + 1) * day);
  assert.equal(birthDateChange(a, b, old, NOW), "change");
  assert.equal(birthDateLocked(recent, NOW), true);
  assert.equal(birthDateLocked(old, NOW), false);
  assert.equal(birthDateLocked(null, NOW), false);
});

test("birthDateChange: gleicher Tag gilt als unverändert, auch wenn der gespeicherte Wert nicht auf Mitternacht liegt", async () => {
  const { birthDateChange } = await import("./rider-person");
  const stored = new Date(Date.UTC(1990, 4, 2, 22, 0));
  const sent = new Date(Date.UTC(1990, 4, 2));
  const recent = new Date(NOW.getTime() - 10 * 86_400_000);
  assert.equal(birthDateChange(stored, sent, null, NOW), "same");
  assert.equal(birthDateChange(stored, sent, recent, NOW), "same");
  assert.equal(birthDateChange(stored, new Date(Date.UTC(1990, 4, 3)), null, NOW), "change");
});
