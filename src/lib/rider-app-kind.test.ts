import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_PREFIX, beachToAppPath, riderManifest, riderRestOf } from "./rider-app-kind";

const TOKEN = "beachLenaToken12345678";

test("beachToAppPath schreibt nur /beach um", () => {
  assert.equal(beachToAppPath("/beach"), "/app");
  assert.equal(beachToAppPath(`/beach/${TOKEN}/awards`), `/app/${TOKEN}/awards`);
  assert.equal(beachToAppPath("/beachclub"), null);
  assert.equal(beachToAppPath("/app"), null);
});

test("riderRestOf gibt nur einfache Pfade nach dem Token weiter", () => {
  assert.equal(riderRestOf(`/app/${TOKEN}`), "");
  assert.equal(riderRestOf(`/app/${TOKEN}/gutscheine/12`), "/gutscheine/12");
  assert.equal(riderRestOf(`/app/${TOKEN}//evil.example`), "");
  assert.equal(riderRestOf("/app/kurz/awards"), "");
  assert.equal(riderRestOf("/dashboard"), "");
});

test("riderManifest: eigener Name, Icon und Bereich je App", () => {
  const beach = riderManifest("beach", `/beach/${TOKEN}`, "Tuttenbrocksee");
  assert.equal(beach.name, "Beach Pass · Tuttenbrocksee");
  assert.equal(beach.scope, APP_PREFIX.beach);
  assert.ok(beach.icons.every((i) => i.src.startsWith("/app-icons/beach-pass-")));
  const ride = riderManifest("ride", "/app");
  assert.equal(ride.short_name, "Ride Pass");
  assert.equal(ride.scope, "/app");
});
