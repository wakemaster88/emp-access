import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRiderAlsPath, riderAlsPath } from "./rider-als";

const ME = "aaaaaaaaaaaaaaaaaaaaaaaa";
const KID = "bbbbbbbbbbbbbbbbbbbbbbbb";

describe("parseRiderAlsPath", () => {
  it("schreibt Seiten der Person auf deren Pfad um", () => {
    assert.deepEqual(parseRiderAlsPath(`/app/${ME}/als/${KID}`), {
      viewer: ME, person: KID, base: `/app/${ME}/als/${KID}`, target: `/app/${KID}`,
    });
    assert.equal(parseRiderAlsPath(`/app/${ME}/als/${KID}/awards/3`)?.target, `/app/${KID}/awards/3`);
  });

  it("lässt eigene Seiten, Anmeldung und Manifest in Ruhe", () => {
    assert.equal(parseRiderAlsPath(`/app/${ME}`), null);
    assert.equal(parseRiderAlsPath(`/app/${ME}/profil`), null);
    assert.equal(parseRiderAlsPath(`/app/${ME}/als/${ME}`), null);
    assert.equal(parseRiderAlsPath(`/app/${ME}/als/${KID}/anmelden`), null);
    assert.equal(parseRiderAlsPath(`/app/${ME}/als/${KID}/manifest.webmanifest`), null);
  });

  it("nimmt nur gültige Tokens", () => {
    assert.equal(parseRiderAlsPath(`/app/${ME}/als/kurz`), null);
    assert.equal(parseRiderAlsPath(`/app/${ME}/als/${KID}%2F..`), null);
  });
});

describe("riderAlsPath", () => {
  it("baut den Link aus Sicht der angemeldeten Person", () => {
    assert.equal(riderAlsPath(ME, ME), `/app/${ME}`);
    assert.equal(riderAlsPath(ME, KID), `/app/${ME}/als/${KID}`);
  });
});
