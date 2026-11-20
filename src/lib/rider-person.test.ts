import { test } from "node:test";
import assert from "node:assert/strict";
import { initials, parsePersonInput, PHOTO_MAX_CHARS } from "./rider-person";

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
