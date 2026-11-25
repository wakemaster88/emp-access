import { test } from "node:test";
import assert from "node:assert/strict";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES, loginFailedMessage } from "./login-limits";
import * as lockout from "./login-lockout";

process.env.AUTH_SECRET ||= "test-secret-nur-fuer-tests";

test("loginFailedMessage: nennt die echten Grenzen, den Passkey nur auf Wunsch", () => {
  const plain = loginFailedMessage(false);
  assert.ok(plain.startsWith("Ungültige Anmeldedaten."));
  assert.ok(plain.includes(`${LOGIN_MAX_FAILURES} Fehlversuchen`));
  assert.ok(plain.includes(`${LOGIN_LOCK_MINUTES} Minuten`));
  assert.ok(!plain.includes("Passkey"));
  assert.ok(loginFailedMessage(true).includes("Passkey"));
});

test("login-lockout nutzt dieselben Grenzen wie die Anmeldeseite", () => {
  assert.equal(lockout.LOGIN_MAX_FAILURES, LOGIN_MAX_FAILURES);
  assert.equal(lockout.LOGIN_LOCK_MINUTES, LOGIN_LOCK_MINUTES);
});
