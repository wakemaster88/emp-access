import { test } from "node:test";
import { hash } from "bcryptjs";
import assert from "node:assert/strict";
import { fakeLoginLockDb, type FakeLoginLockRow } from "./testing/fake-admin-db";
import * as lockout from "./login-lockout";

// secret-box leitet den Schluessel erst beim ersten Gebrauch ab.
process.env.AUTH_SECRET ||= "test-secret-nur-fuer-tests";

const { LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES, LOGIN_SLOWDOWN_MS, LOGIN_PACE_WAIT_MS } = lockout;

const KEY = { emailHash: "mail-1", ipHash: "ip-a" };
const OTHER_IP = { emailHash: "mail-1", ipHash: "ip-b" };

const NOW = new Date("2026-11-24T10:00:00Z");

function rowOf(db: ReturnType<typeof fakeLoginLockDb>, key = KEY): FakeLoginLockRow | undefined {
  return db.rows.find((r) => r.emailHash === key.emailHash && r.ipHash === key.ipHash);
}

function failuresOf(db: ReturnType<typeof fakeLoginLockDb>, key = KEY): number {
  return rowOf(db, key)?.failures ?? 0;
}

function lockedRow(key = KEY, lockedUntil: Date | null, failures = LOGIN_MAX_FAILURES): FakeLoginLockRow {
  return { ...key, failures, lockedUntil, lastAttemptAt: NOW };
}

test("reserveLoginAttempt: zaehlt jeden Versuch und sperrt beim letzten Fehlversuch", async () => {
  const db = fakeLoginLockDb();
  for (let i = 1; i <= LOGIN_MAX_FAILURES; i++) {
    assert.equal(await lockout.reserveLoginAttempt(KEY, NOW, db), true, `Versuch ${i}`);
    await lockout.lockLoginIfExhausted(KEY, NOW, db);
  }
  const row = rowOf(db)!;
  assert.equal(row.failures, LOGIN_MAX_FAILURES);
  assert.ok(row.lockedUntil && row.lockedUntil.getTime() === NOW.getTime() + LOGIN_LOCK_MINUTES * 60_000);
  assert.equal(await lockout.reserveLoginAttempt(KEY, NOW, db), false);
});

test("reserveLoginAttempt: gleichzeitige Anfragen mit demselben gelesenen Stand kommen nicht alle durch", async () => {
  const db = fakeLoginLockDb();
  // 200 Anfragen starten gleichzeitig, als noch nichts gezaehlt war.
  const results = await Promise.all(
    Array.from({ length: 200 }, () => lockout.reserveLoginAttempt(KEY, NOW, db)),
  );
  assert.equal(results.filter(Boolean).length, LOGIN_MAX_FAILURES);
  assert.equal(failuresOf(db), LOGIN_MAX_FAILURES);
  assert.equal(db.rows.length, 1);
  // Die Abgewiesenen tragen die Sperrzeit nach, auch wenn noch keiner der
  // Durchgelassenen seinen Fehlversuch gemeldet hat.
  const until = rowOf(db)!.lockedUntil;
  assert.ok(until && until > NOW);
});

test("clearLoginFailures: hebt eine bestehende Sperre nicht auf", async () => {
  const db = fakeLoginLockDb([lockedRow(KEY, new Date(NOW.getTime() + 60_000))]);
  await lockout.clearLoginFailures(KEY, NOW, db);
  assert.equal(failuresOf(db), LOGIN_MAX_FAILURES);
  assert.ok(rowOf(db)!.lockedUntil);
});

test("clearLoginFailures: richtiges Passwort setzt den Zaehler zurueck", async () => {
  const db = fakeLoginLockDb();
  assert.equal(await lockout.reserveLoginAttempt(KEY, NOW, db), true);
  assert.equal(failuresOf(db), 1);
  await lockout.clearLoginFailures(KEY, NOW, db);
  assert.equal(failuresOf(db), 0);
  // Die IP gilt danach als bekannt und ist von der Taktung ausgenommen.
  assert.equal(await lockout.isKnownLoginIp(KEY, NOW, db), true);
  assert.equal(await lockout.isKnownLoginIp(OTHER_IP, NOW, db), false);
});

test("reserveLoginAttempt: abgelaufene Sperre gibt wieder alle Versuche frei", async () => {
  const db = fakeLoginLockDb([lockedRow(KEY, new Date(NOW.getTime() - 1_000))]);
  assert.equal(await lockout.reserveLoginAttempt(KEY, NOW, db), true);
  assert.equal(failuresOf(db), 1);
  assert.equal(rowOf(db)!.lockedUntil, null);
});

test("reserveLoginAttempt: waehrend der Sperre wird nichts gezaehlt", async () => {
  const until = new Date(NOW.getTime() + 60_000);
  const db = fakeLoginLockDb([lockedRow(KEY, until)]);
  assert.equal(await lockout.reserveLoginAttempt(KEY, NOW, db), false);
  assert.equal(failuresOf(db), LOGIN_MAX_FAILURES);
  assert.equal(rowOf(db)!.lockedUntil, until);
});

test("reserveLoginAttempt: voller Zaehler ohne Sperrzeit bleibt nicht dauerhaft haengen", async () => {
  // Anfrage mit dem letzten Versuch ist vor dem Sperren abgebrochen.
  const db = fakeLoginLockDb([lockedRow(KEY, null)]);
  assert.equal(await lockout.reserveLoginAttempt(KEY, NOW, db), false);
  const until = rowOf(db)!.lockedUntil;
  assert.ok(until && until > NOW);
  const later = new Date(until.getTime() + 1_000);
  assert.equal(await lockout.reserveLoginAttempt(KEY, later, db), true);
});

test("reserveLoginAttempt: Sperre einer IP laesst andere IPs desselben Kontos durch", async () => {
  const db = fakeLoginLockDb([lockedRow(KEY, new Date(NOW.getTime() + 60_000))]);
  assert.equal(await lockout.reserveLoginAttempt(KEY, NOW, db), false);
  assert.equal(await lockout.reserveLoginAttempt(OTHER_IP, NOW, db), true);
  assert.equal(failuresOf(db, OTHER_IP), 1);
  // Ein anderes Konto hinter derselben IP ist ebenso unberuehrt.
  assert.equal(await lockout.reserveLoginAttempt({ emailHash: "mail-2", ipHash: KEY.ipHash }, NOW, db), true);
});

test("loginSlowdownMs: viele Fehlversuche ueber alle IPs verlangsamen nur, ohne zu sperren", async () => {
  const db = fakeLoginLockDb();
  assert.equal(await lockout.loginSlowdownMs("mail-1", NOW, db), 0);
  for (let ip = 0; ip < LOGIN_MAX_FAILURES; ip++) {
    assert.equal(await lockout.reserveLoginAttempt({ emailHash: "mail-1", ipHash: `ip-${ip}` }, NOW, db), true);
  }
  assert.equal(await lockout.loginSlowdownMs("mail-1", NOW, db), LOGIN_SLOWDOWN_MS);
  // Andere Konten bleiben schnell.
  assert.equal(await lockout.loginSlowdownMs("mail-2", NOW, db), 0);
  // Eine neue IP kommt trotz Verlangsamung durch.
  assert.equal(await lockout.reserveLoginAttempt({ emailHash: "mail-1", ipHash: "ip-neu" }, NOW, db), true);
  // Nach dem Sperrfenster zaehlen die alten Versuche nicht mehr.
  const later = new Date(NOW.getTime() + (LOGIN_LOCK_MINUTES + 1) * 60_000);
  assert.equal(await lockout.loginSlowdownMs("mail-1", later, db), 0);
});

test("pruneLoginLocks: raeumt seit einem Tag ruhende Eintraege weg, bekannte IPs bleiben", async () => {
  const old = new Date(NOW.getTime() - 2 * 24 * 60 * 60_000);
  const db = fakeLoginLockDb(
    [
      { emailHash: "mail-1", ipHash: "alt", failures: 3, lockedUntil: null, lastAttemptAt: old },
      { emailHash: "mail-2", ipHash: "alt", failures: 3, lockedUntil: null, lastAttemptAt: old },
      { emailHash: "mail-1", ipHash: "bekannt", failures: 0, lockedUntil: null, lastAttemptAt: old, succeededAt: old },
      { emailHash: "mail-1", ipHash: "frisch", failures: 1, lockedUntil: null, lastAttemptAt: NOW },
    ],
    [
      { emailHash: "mail-1", nextAllowedAt: old },
      { emailHash: "mail-2", nextAllowedAt: NOW },
    ],
  );
  await lockout.pruneLoginLocks(NOW, db);
  assert.deepEqual(
    db.rows.map((r) => `${r.emailHash}/${r.ipHash}`),
    ["mail-1/bekannt", "mail-1/frisch"],
  );
  assert.deepEqual(
    db.paceRows.map((r) => r.emailHash),
    ["mail-2"],
  );
});

test("resetLoginLocks: neues Passwort hebt Sperren der E-Mail an allen IPs auf", async () => {
  const until = new Date(NOW.getTime() + 60_000);
  const mail = lockout.loginEmailHash("admin@example.test");
  const db = fakeLoginLockDb([
    lockedRow({ emailHash: mail, ipHash: "ip-a" }, until),
    lockedRow({ emailHash: mail, ipHash: "ip-b" }, until),
    lockedRow({ emailHash: "andere", ipHash: "ip-a" }, until),
  ]);
  await lockout.resetLoginLocks("Admin@Example.test", db);
  assert.equal(await lockout.reserveLoginAttempt({ emailHash: mail, ipHash: "ip-a" }, NOW, db), true);
  assert.equal(await lockout.reserveLoginAttempt({ emailHash: mail, ipHash: "ip-b" }, NOW, db), true);
  assert.equal(await lockout.reserveLoginAttempt({ emailHash: "andere", ipHash: "ip-a" }, NOW, db), false);
});

test("takeLoginPaceSlot: von gleichzeitigen Anfragen kommt je Takt nur eine durch", async () => {
  const db = fakeLoginLockDb();
  const results = await Promise.all(
    Array.from({ length: 200 }, () => lockout.takeLoginPaceSlot("mail-1", NOW, db)),
  );
  assert.equal(results.filter(Boolean).length, 1);
  // Andere E-Mails haben ihren eigenen Takt.
  assert.equal(await lockout.takeLoginPaceSlot("mail-2", NOW, db), true);
  // Im selben Takt nichts mehr, danach wieder genau eine.
  assert.equal(await lockout.takeLoginPaceSlot("mail-1", new Date(NOW.getTime() + LOGIN_SLOWDOWN_MS - 1), db), false);
  const next = new Date(NOW.getTime() + LOGIN_SLOWDOWN_MS);
  const again = await Promise.all(Array.from({ length: 50 }, () => lockout.takeLoginPaceSlot("mail-1", next, db)));
  assert.equal(again.filter(Boolean).length, 1);
});

test("checkLoginPassword: unbekannte E-Mail zaehlt wie eine bekannte", async () => {
  const db = fakeLoginLockDb();
  const known = { id: 1, password: lockout.DUMMY_PASSWORD_HASH };
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    const unknown = await lockout.checkLoginPassword(null, "niemand@example.test", "falsch", "198.51.100.7", NOW, db);
    assert.equal(unknown.valid, false);
    const wrong = await lockout.checkLoginPassword(known, "admin@example.test", "falsch", "198.51.100.7", NOW, db);
    assert.equal(wrong.valid, false);
  }
  const unknownHash = lockout.loginEmailHash("niemand@example.test");
  const knownHash = lockout.loginEmailHash("admin@example.test");
  assert.equal(await lockout.loginSlowdownMs(unknownHash, NOW, db), LOGIN_SLOWDOWN_MS);
  assert.equal(await lockout.loginSlowdownMs(knownHash, NOW, db), LOGIN_SLOWDOWN_MS);
  assert.deepEqual(
    db.rows.map((r) => [r.failures, r.lockedUntil?.getTime() ?? null]),
    [
      [LOGIN_MAX_FAILURES, NOW.getTime() + LOGIN_LOCK_MINUTES * 60_000],
      [LOGIN_MAX_FAILURES, NOW.getTime() + LOGIN_LOCK_MINUTES * 60_000],
    ],
  );
});

test("checkLoginPassword: viele Fehlversuche takten neue IPs, bekannte IPs kommen durch", async () => {
  const mail = lockout.loginEmailHash("admin@example.test");
  const knownIp = "203.0.113.5";
  const rows: FakeLoginLockRow[] = Array.from({ length: LOGIN_MAX_FAILURES }, (_, i) => ({
    emailHash: mail,
    ipHash: `alt-${i}`,
    failures: 1,
    lockedUntil: null,
    lastAttemptAt: NOW,
  }));
  rows.push({
    emailHash: mail,
    ipHash: lockout.loginIpHash(knownIp),
    failures: 0,
    lockedUntil: null,
    lastAttemptAt: NOW,
    succeededAt: NOW,
  });
  const db = fakeLoginLockDb(rows);
  const admin = { id: 1, password: await hash("richtig", 4) };

  const [known, ...strangers] = await Promise.all([
    lockout.checkLoginPassword(admin, "admin@example.test", "richtig", knownIp, NOW, db),
    ...Array.from({ length: 20 }, (_, i) =>
      lockout.checkLoginPassword(admin, "admin@example.test", "richtig", `2001:db8:${i}::1`, NOW, db),
    ),
  ]);
  assert.equal(known.valid, true);
  // Je Takt erreicht nur eine der neuen IPs den Vergleich; die anderen warten
  // hoechstens LOGIN_PACE_WAIT_MS auf einen freien Takt.
  const passed = strangers.filter((r) => r.valid).length;
  assert.ok(passed >= 1);
  assert.ok(passed <= 1 + Math.floor(LOGIN_PACE_WAIT_MS / LOGIN_SLOWDOWN_MS));
  // Wer keinen Takt bekam, hat seinen reservierten Versuch zurueckgegeben.
  const strangerRows = db.rows.filter((r) => !r.ipHash.startsWith("alt-") && r.ipHash !== lockout.loginIpHash(knownIp));
  assert.equal(strangerRows.filter((r) => r.failures > 0).length, passed);
});

/** Zeilen, mit denen die E-Mail ueber alle IPs verlangsamt ist. */
function slowdownRows(mail: string): FakeLoginLockRow[] {
  return Array.from({ length: LOGIN_MAX_FAILURES }, (_, i) => ({
    emailHash: mail,
    ipHash: `alt-${i}`,
    failures: 1,
    lockedUntil: null,
    lastAttemptAt: NOW,
  }));
}

test("checkLoginPassword: ein gesperrter Anschluss belegt keinen Takt", async () => {
  const email = "admin@example.test";
  const mail = lockout.loginEmailHash(email);
  const attackerIp = "2001:db8:aa:1::5";
  const rows = slowdownRows(mail);
  rows.push({ ...lockedRow(lockout.loginLockKey(email, attackerIp), new Date(NOW.getTime() + 60_000)) });
  const db = fakeLoginLockDb(rows);
  const admin = { id: 1, password: await hash("richtig", 4) };

  // Viele gleichzeitige Anfragen aus dem gesperrten /64 (wechselnde Adressen).
  const attacks = await Promise.all(
    Array.from({ length: 5 }, (_, i) => lockout.checkLoginPassword(admin, email, "falsch", `2001:db8:aa:1::${i + 10}`, NOW, db)),
  );
  assert.ok(attacks.every((r) => !r.valid));
  assert.equal(db.paceRows.length, 0);

  // Der Admin von einem neuen Anschluss bekommt den Takt und kommt hinein.
  const admitted = await lockout.checkLoginPassword(admin, email, "richtig", "198.51.100.20", NOW, db);
  assert.equal(admitted.valid, true);
});

test("checkLoginPassword: ohne freien Takt zaehlt der Versuch nicht", async () => {
  const email = "admin@example.test";
  const mail = lockout.loginEmailHash(email);
  const db = fakeLoginLockDb(slowdownRows(mail), [{ emailHash: mail, nextAllowedAt: new Date(NOW.getTime() + 60_000) }]);
  const admin = { id: 1, password: await hash("richtig", 4) };

  const result = await lockout.checkLoginPassword(admin, email, "richtig", "198.51.100.30", NOW, db);
  assert.equal(result.valid, false);
  assert.equal(failuresOf(db, result.key), 0);
});

test("waitForLoginPaceSlot: wartet auf den naechsten freien Takt, mit Obergrenze", async () => {
  const db = fakeLoginLockDb([], [
    { emailHash: "mail-1", nextAllowedAt: new Date(NOW.getTime() + 300) },
    { emailHash: "mail-2", nextAllowedAt: new Date(NOW.getTime() + 60_000) },
  ]);
  assert.equal(await lockout.waitForLoginPaceSlot("mail-1", NOW, db, 1_000), true);
  const started = Date.now();
  assert.equal(await lockout.waitForLoginPaceSlot("mail-2", NOW, db, 400), false);
  assert.ok(Date.now() - started < 1_000);
});

test("releaseLoginAttempt: gibt genau einen reservierten Versuch zurueck", async () => {
  const db = fakeLoginLockDb([{ ...KEY, failures: 3, lockedUntil: null, lastAttemptAt: NOW }, lockedRow(OTHER_IP, new Date(NOW.getTime() + 60_000))]);
  await lockout.releaseLoginAttempt(KEY, db);
  assert.equal(failuresOf(db), 2);
  // Eine bestehende Sperre bleibt unberuehrt.
  await lockout.releaseLoginAttempt(OTHER_IP, db);
  assert.equal(failuresOf(db, OTHER_IP), LOGIN_MAX_FAILURES);
});

test("loginIpHash: stabil, je IP verschieden und ohne die IP im Klartext", () => {
  const ip = "198.51.100.7";
  const a = lockout.loginIpHash(ip);
  assert.equal(a, lockout.loginIpHash(ip));
  assert.notEqual(a, lockout.loginIpHash("198.51.100.8"));
  assert.ok(!a.includes(ip));
});

test("loginIpKey: IPv6 zaehlt je /64, IPv4 in IPv6 wie IPv4", () => {
  const a = lockout.loginIpHash("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
  assert.equal(a, lockout.loginIpHash("2001:db8:1:2::1"));
  assert.equal(a, lockout.loginIpHash("2001:0DB8:0001:0002:0:0:0:ffff"));
  assert.notEqual(a, lockout.loginIpHash("2001:db8:1:3::1"));
  assert.equal(lockout.loginIpKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(lockout.loginIpKey("::ffff:198.51.100.7"), "198.51.100.7");
  assert.equal(lockout.loginIpHash("::ffff:198.51.100.7"), lockout.loginIpHash("198.51.100.7"));
  assert.equal(lockout.loginIpKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(lockout.loginIpKey("198.51.100.7"), "198.51.100.7");
  // Unlesbares bleibt unveraendert und zaehlt fuer sich.
  assert.equal(lockout.loginIpKey("-"), "-");
  assert.equal(lockout.loginIpKey("1:2:3"), "1:2:3");
  assert.equal(lockout.loginIpKey("1::2::3"), "1::2::3");
});

test("loginEmailHash: gross/klein gleich, ohne die E-Mail im Klartext", () => {
  const a = lockout.loginEmailHash("admin@example.test");
  assert.equal(a, lockout.loginEmailHash(" Admin@Example.TEST "));
  assert.notEqual(a, lockout.loginEmailHash("admin2@example.test"));
  assert.ok(!a.includes("admin"));
});
