import { test } from "node:test";
import assert from "node:assert/strict";

test("appCode: 15 Minuten gültig, nur unverändert und mit Geheimnis", async () => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  const { appCode, readAppCode } = await import("./rider-kasse-link");
  const now = new Date("2026-11-20T12:00:30Z");
  const { code, expiresAt } = appCode(4711, now);
  assert.match(code, /^APP\d+$/);
  assert.equal(expiresAt.toISOString(), "2026-11-20T12:15:00.000Z");
  assert.deepEqual(readAppCode(code, now), { profileId: 4711 });
  assert.deepEqual(readAppCode(code, new Date("2026-11-20T12:15:00Z")), { profileId: 4711 });
  assert.deepEqual(readAppCode(code, new Date("2026-11-20T12:15:01Z")), { invalid: true });

  // Andere Person mit derselben Prüfsumme: ungültig.
  assert.deepEqual(readAppCode(code.replace(/4711$/, "4712"), now), { invalid: true });
  // Prüfsumme verändert.
  const flipped = code.slice(0, 12) + (code[12] === "0" ? "1" : "0") + code.slice(13);
  assert.deepEqual(readAppCode(flipped, now), { invalid: true });

  // So, wie Scanner es manchmal schicken: klein, mit Leerraum oder Präfix.
  assert.deepEqual(readAppCode(` ${code.toLowerCase()}\n`, now), { profileId: 4711 });
  assert.deepEqual(readAppCode(`#${code}`, now), { profileId: 4711 });

  process.env.AUTH_SECRET = "";
  assert.deepEqual(readAppCode(code, now), { invalid: true });
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
});

test("readAppCode: andere Codes sind keine App-Codes", async () => {
  const { readAppCode } = await import("./rider-kasse-link");
  for (const other of ["", "GS-ABCD-1234", "0012345678", "APP", "APP123", "anny-sub:abc", "https://example.org/app/x"]) {
    assert.equal(readAppCode(other), null, other);
  }
});

test("sameFirstName: gleich, Groß/klein egal, oder einer fehlt", async () => {
  const { sameFirstName } = await import("./rider-kasse-link");
  assert.equal(sameFirstName("Lisa", "lisa"), true);
  assert.equal(sameFirstName(" Lisa ", "LISA"), true);
  assert.equal(sameFirstName(null, "Lisa"), true);
  assert.equal(sameFirstName("Lisa", ""), true);
  assert.equal(sameFirstName("Lisa", "Ben"), false);
});
