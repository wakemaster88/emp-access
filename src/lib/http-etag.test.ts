import { test } from "node:test";
import assert from "node:assert/strict";
import { ifNoneMatchMatches, jsonEtag } from "./http-etag";

test("jsonEtag: gleiche Daten, gleiches ETag; andere Daten, anderes ETag", () => {
  const a = jsonEtag({ zone: { id: 1, volume: 50 }, jobs: [] });
  assert.equal(a, jsonEtag({ zone: { id: 1, volume: 50 }, jobs: [] }));
  assert.notEqual(a, jsonEtag({ zone: { id: 1, volume: 51 }, jobs: [] }));
  assert.match(a, /^W\/"[A-Za-z0-9_-]{16}"$/);
});

test("ifNoneMatchMatches: weak, strong, Liste und leer", () => {
  const etag = jsonEtag({ a: 1 });
  const strong = etag.replace(/^W\//, "");
  assert.equal(ifNoneMatchMatches(null, etag), false);
  assert.equal(ifNoneMatchMatches("", etag), false);
  assert.equal(ifNoneMatchMatches(etag, etag), true);
  assert.equal(ifNoneMatchMatches(strong, etag), true);
  assert.equal(ifNoneMatchMatches(`W/"anders", ${etag}`, etag), true);
  assert.equal(ifNoneMatchMatches('W/"anders"', etag), false);
});
