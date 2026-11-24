import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeAdminDb } from "./testing/fake-admin-db";
import * as lockout from "./login-lockout";

const { LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES } = lockout;

function makeAdmin() {
  return { id: 1, loginFailures: 0, loginLockedUntil: null as Date | null };
}

const NOW = new Date("2026-11-24T10:00:00Z");

test("reserveLoginAttempt: zaehlt jeden Versuch und sperrt beim letzten Fehlversuch", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  for (let i = 1; i <= LOGIN_MAX_FAILURES; i++) {
    assert.equal(await lockout.reserveLoginAttempt({ ...admin }, NOW, db), true, `Versuch ${i}`);
    await lockout.lockLoginIfExhausted(admin.id, NOW, db);
  }
  assert.equal(admin.loginFailures, LOGIN_MAX_FAILURES);
  assert.ok(admin.loginLockedUntil && admin.loginLockedUntil.getTime() === NOW.getTime() + LOGIN_LOCK_MINUTES * 60_000);
  assert.equal(await lockout.reserveLoginAttempt({ ...admin }, NOW, db), false);
});

test("reserveLoginAttempt: gleichzeitige Anfragen mit demselben gelesenen Stand kommen nicht alle durch", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  // 200 Anfragen haben den Datensatz gelesen, als noch nichts gezaehlt war.
  const snapshot = { ...admin };
  const results = await Promise.all(
    Array.from({ length: 200 }, () => lockout.reserveLoginAttempt(snapshot, NOW, db)),
  );
  assert.equal(results.filter(Boolean).length, LOGIN_MAX_FAILURES);
  assert.equal(admin.loginFailures, LOGIN_MAX_FAILURES);
  // Die Abgewiesenen tragen die Sperrzeit nach, auch wenn noch keiner der
  // Durchgelassenen seinen Fehlversuch gemeldet hat.
  assert.ok(admin.loginLockedUntil && admin.loginLockedUntil > NOW);
});

test("clearLoginFailures: hebt eine bestehende Sperre nicht auf", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  admin.loginFailures = LOGIN_MAX_FAILURES;
  admin.loginLockedUntil = new Date(NOW.getTime() + 60_000);
  await lockout.clearLoginFailures(admin.id, db);
  assert.equal(admin.loginFailures, LOGIN_MAX_FAILURES);
  assert.ok(admin.loginLockedUntil);
});

test("clearLoginFailures: richtiges Passwort setzt den Zaehler zurueck", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  assert.equal(await lockout.reserveLoginAttempt({ ...admin }, NOW, db), true);
  assert.equal(admin.loginFailures, 1);
  await lockout.clearLoginFailures(admin.id, db);
  assert.equal(admin.loginFailures, 0);
});

test("reserveLoginAttempt: abgelaufene Sperre gibt wieder alle Versuche frei", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  admin.loginFailures = LOGIN_MAX_FAILURES;
  admin.loginLockedUntil = new Date(NOW.getTime() - 1_000);
  assert.equal(await lockout.reserveLoginAttempt({ ...admin }, NOW, db), true);
  assert.equal(admin.loginFailures, 1);
  assert.equal(admin.loginLockedUntil, null);
});

test("reserveLoginAttempt: waehrend der Sperre wird nichts gezaehlt", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  admin.loginFailures = LOGIN_MAX_FAILURES;
  admin.loginLockedUntil = new Date(NOW.getTime() + 60_000);
  const until = admin.loginLockedUntil;
  assert.equal(await lockout.reserveLoginAttempt({ ...admin }, NOW, db), false);
  assert.equal(admin.loginFailures, LOGIN_MAX_FAILURES);
  assert.equal(admin.loginLockedUntil, until);
});

test("reserveLoginAttempt: voller Zaehler ohne Sperrzeit bleibt nicht dauerhaft haengen", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  // Anfrage mit dem letzten Versuch ist vor dem Sperren abgebrochen.
  admin.loginFailures = LOGIN_MAX_FAILURES;
  assert.equal(await lockout.reserveLoginAttempt({ ...admin }, NOW, db), false);
  assert.ok(admin.loginLockedUntil && admin.loginLockedUntil > NOW);
  const later = new Date(admin.loginLockedUntil!.getTime() + 1_000);
  assert.equal(await lockout.reserveLoginAttempt({ ...admin }, later, db), true);
});
