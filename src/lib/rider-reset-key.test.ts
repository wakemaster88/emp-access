import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskEmail, resetKeyProfileId, signResetKey, verifyResetKey } from "./rider-reset-key";

const SECRET = "test-secret";
const now = new Date("2026-11-20T21:00:00Z");
const profile = { id: 42, sessionVersion: 3, passwordHash: "$2a$10$abcdefghijklmnopqrstuv" };

describe("Schlüssel für Passwort vergessen", () => {
  it("gilt für dieses Profil innerhalb von 60 Minuten", () => {
    const key = signResetKey(profile, SECRET, now);
    assert.equal(resetKeyProfileId(key), 42);
    assert.equal(verifyResetKey(key, profile, SECRET, new Date(now.getTime() + 59 * 60_000)), true);
    assert.equal(verifyResetKey(key, profile, SECRET, new Date(now.getTime() + 61 * 60_000)), false);
  });

  it("gilt nicht mehr, sobald Sitzungen beendet oder das Passwort neu ist", () => {
    const key = signResetKey(profile, SECRET, now);
    assert.equal(verifyResetKey(key, { ...profile, sessionVersion: 4 }, SECRET, now), false);
    assert.equal(verifyResetKey(key, { ...profile, passwordHash: "$2a$10$zzzzzzzzzzzzzzzzzzzzzz" }, SECRET, now), false);
  });

  it("passt nicht zu einem anderen Profil, Geheimnis oder verändertem Schlüssel", () => {
    const key = signResetKey(profile, SECRET, now);
    assert.equal(verifyResetKey(key, { ...profile, id: 43 }, SECRET, now), false);
    assert.equal(verifyResetKey(key, profile, "anderes", now), false);
    assert.equal(verifyResetKey(key, profile, "", now), false);
    assert.equal(verifyResetKey(key.replace(/.$/, (c) => (c === "A" ? "B" : "A")), profile, SECRET, now), false);
    assert.equal(verifyResetKey("42.1.kaputt", profile, SECRET, now), false);
    assert.equal(verifyResetKey(undefined, profile, SECRET, now), false);
  });

  it("gilt auch für Zugänge nur mit Passkey", () => {
    const p = { ...profile, passwordHash: null };
    assert.equal(verifyResetKey(signResetKey(p, SECRET, now), p, SECRET, now), true);
  });
});

describe("maskEmail", () => {
  it("zeigt nur den Anfang", () => {
    assert.equal(maskEmail("aaron@beispiel.de"), "aa•••@be•••.de");
    assert.equal(maskEmail("a@b.de"), "a•••@b•••.de");
  });
});
