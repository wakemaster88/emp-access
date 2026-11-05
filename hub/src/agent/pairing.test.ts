import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_TTL_MS, MAX_ATTEMPTS, handleUnknownChat, isPaired, newPairingState } from "./pairing.js";

const code = () => "123456";

test("Erste Nachricht erzeugt einen Code, richtiger Code koppelt", () => {
  const st = newPairingState();
  assert.deepEqual(handleUnknownChat(st, "42", "Aaron", "Hallo", 0, code), { kind: "issued", code: "123456" });
  assert.deepEqual(handleUnknownChat(st, "42", "Aaron", "Hallo nochmal", 1000, code), { kind: "pending" });
  const r = handleUnknownChat(st, "42", "Aaron", "123 456", 2000, code);
  assert.equal(r.kind, "paired");
  assert.equal(isPaired(st, "42"), true);
  assert.equal(st.code, null);
});

test("Falsche Codes sperren nach fuenf Versuchen", () => {
  const st = newPairingState();
  handleUnknownChat(st, "7", "x", "hi", 0, code);
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    assert.deepEqual(handleUnknownChat(st, "7", "x", "000000", i, code), { kind: "wrong", left: MAX_ATTEMPTS - i });
  }
  assert.deepEqual(handleUnknownChat(st, "7", "x", "000000", 10, code), { kind: "locked" });
  // Auch der richtige Code hilft jetzt nicht mehr.
  assert.deepEqual(handleUnknownChat(st, "7", "x", "123456", 11, code), { kind: "locked" });
  // Nach Ablauf gibt es einen neuen Code.
  assert.equal(handleUnknownChat(st, "7", "x", "hi", CODE_TTL_MS + 1, code).kind, "issued");
});

test("Abgelaufener Code koppelt nicht", () => {
  const st = newPairingState();
  handleUnknownChat(st, "1", "a", "hi", 0, code);
  assert.equal(handleUnknownChat(st, "1", "a", "123456", CODE_TTL_MS + 5, code).kind, "issued");
  assert.equal(isPaired(st, "1"), false);
});

test("Chat-IDs aus der .env gelten ohne Kopplung", () => {
  assert.equal(isPaired(newPairingState(), "99", ["99"]), true);
});
