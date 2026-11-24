import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeAdminDb } from "./testing/fake-admin-db";
import { keyedFingerprint, sealSecret } from "./secret-box";
import { currentTotpStep, generateTotpSecret, totpCodeForStep } from "./totp";
import { verifySecondFactor, type TwoFactorFields } from "./two-factor";

// secret-box leitet den Schluessel erst beim ersten Gebrauch ab.
process.env.AUTH_SECRET ||= "test-secret-nur-fuer-tests";

const NOW_MS = 1_800_000_000_000;
const NOW = new Date(NOW_MS);
const STEP = currentTotpStep(NOW_MS);
const SECRET = generateTotpSecret();
const RECOVERY = "ABCDE-FGHJK";

function makeAdmin(): TwoFactorFields {
  return {
    id: 1,
    twoFactorSecret: sealSecret(SECRET),
    twoFactorEnabledAt: new Date(NOW_MS - 86_400_000),
    twoFactorRecoveryCodes: [keyedFingerprint("admin-recovery-code", RECOVERY.replace(/-/g, ""))],
    twoFactorLastStep: null,
    twoFactorFailures: 0,
    twoFactorLockedUntil: null,
  };
}

/** Ein sechsstelliger Code, der in keinem der drei gueltigen Zeitschritte passt. */
function wrongCode(): string {
  const valid = new Set([STEP - 1, STEP, STEP + 1].map((s) => totpCodeForStep(SECRET, s)));
  for (let i = 0; i < 10; i++) {
    const candidate = String(100000 + i);
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error("kein falscher Code gefunden");
}

test("verifySecondFactor: gueltiger Code, danach kein zweites Mal", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  const code = totpCodeForStep(SECRET, STEP);

  const first = await verifySecondFactor(admin, code, { db, now: NOW });
  assert.equal(first.ok, true);
  assert.equal(admin.twoFactorLastStep, STEP);
  assert.equal(admin.twoFactorFailures, 0);

  const replay = await verifySecondFactor(admin, code, { db, now: NOW });
  assert.deepEqual(replay, { ok: false, reason: "invalid" });
  assert.equal(admin.twoFactorFailures, 1);
});

test("verifySecondFactor: fuenf Fehlversuche sperren, auch den richtigen Code", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  const bad = wrongCode();
  let last;
  for (let i = 0; i < 5; i++) last = await verifySecondFactor({ ...admin }, bad, { db, now: NOW });
  assert.equal(last!.ok, false);
  assert.equal(!last!.ok && last!.reason, "locked");
  assert.ok(admin.twoFactorLockedUntil && admin.twoFactorLockedUntil > NOW);

  const right = await verifySecondFactor({ ...admin }, totpCodeForStep(SECRET, STEP), { db, now: NOW });
  assert.equal(!right.ok && right.reason, "locked");

  const later = new Date(NOW_MS + 16 * 60_000);
  const after = await verifySecondFactor({ ...admin }, totpCodeForStep(SECRET, currentTotpStep(later.getTime())), {
    db,
    now: later,
  });
  assert.equal(after.ok, true);
  assert.equal(admin.twoFactorFailures, 0);
  assert.equal(admin.twoFactorLockedUntil, null);
});

test("verifySecondFactor: gleichzeitige Rateversuche zaehlen einzeln", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  // 300 Anfragen haben den Datensatz gelesen, als noch nichts gezaehlt war,
  // und probieren verschiedene Codes – einer davon ist der richtige.
  const snapshot = { ...admin };
  const guesses = Array.from({ length: 299 }, () => wrongCode());
  guesses.push(totpCodeForStep(SECRET, STEP));

  const results = await Promise.all(guesses.map((g) => verifySecondFactor(snapshot, g, { db, now: NOW })));

  // Nur fuenf Versuche wurden ueberhaupt geprueft; der richtige Code an
  // Position 300 kam nicht mehr an die Reihe.
  assert.equal(results.filter((r) => r.ok).length, 0);
  assert.equal(results.filter((r) => !r.ok && r.reason === "locked").length >= 295, true);
  assert.equal(admin.twoFactorFailures, 5);
  assert.ok(admin.twoFactorLockedUntil && admin.twoFactorLockedUntil > NOW);
});

test("verifySecondFactor: derselbe Code gleichzeitig gilt nur einmal", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  const snapshot = { ...admin };
  const code = totpCodeForStep(SECRET, STEP);
  const results = await Promise.all([
    verifySecondFactor(snapshot, code, { db, now: NOW }),
    verifySecondFactor(snapshot, code, { db, now: NOW }),
    verifySecondFactor(snapshot, code, { db, now: NOW }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test("verifySecondFactor: Wiederherstellungscode genau einmal, auch gleichzeitig", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  const snapshot = { ...admin };
  const results = await Promise.all([
    verifySecondFactor(snapshot, "abcde fghjk", { db, now: NOW }),
    verifySecondFactor(snapshot, RECOVERY, { db, now: NOW }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(admin.twoFactorRecoveryCodes.length, 0);

  const unknown = await verifySecondFactor({ ...admin }, "ZZZZZ-ZZZZZ", { db, now: NOW });
  assert.equal(!unknown.ok && unknown.reason, "invalid");
});

test("verifySecondFactor: zwei verschiedene Wiederherstellungscodes gleichzeitig beleben keinen wieder", async () => {
  const second = "MNPQR-STUVW";
  const admin = makeAdmin();
  admin.twoFactorRecoveryCodes = [
    ...admin.twoFactorRecoveryCodes,
    keyedFingerprint("admin-recovery-code", second.replace(/-/g, "")),
  ];
  const db = fakeAdminDb(admin);
  const snapshot = { ...admin };
  const results = await Promise.all([
    verifySecondFactor(snapshot, RECOVERY, { db, now: NOW }),
    verifySecondFactor(snapshot, second, { db, now: NOW }),
  ]);
  // Nur eine Einloesung gewinnt; die andere scheitert, ihr Code bleibt gueltig.
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(admin.twoFactorRecoveryCodes.length, 1);

  const used = results[0].ok ? RECOVERY : second;
  const unused = results[0].ok ? second : RECOVERY;
  const replay = await verifySecondFactor({ ...admin }, used, { db, now: NOW });
  assert.equal(!replay.ok && replay.reason, "invalid");
  const later = await verifySecondFactor({ ...admin }, unused, { db, now: NOW });
  assert.equal(later.ok, true);
  assert.equal(admin.twoFactorRecoveryCodes.length, 0);
});

test("verifySecondFactor: leere Eingabe und unlesbares Secret zaehlen nicht", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  assert.deepEqual(await verifySecondFactor(admin, "", { db, now: NOW }), { ok: false, reason: "missing" });
  assert.equal(admin.twoFactorFailures, 0);

  const broken = { ...makeAdmin(), twoFactorSecret: "v1.kaputt.kaputt.kaputt" };
  const brokenDb = fakeAdminDb(broken);
  assert.deepEqual(await verifySecondFactor(broken, "123456", { db: brokenDb, now: NOW }), {
    ok: false,
    reason: "unreadable",
  });
  assert.equal(broken.twoFactorFailures, 0);
});

test("verifySecondFactor: voller Zaehler ohne Sperrzeit bleibt nicht dauerhaft haengen", async () => {
  const admin = makeAdmin();
  const db = fakeAdminDb(admin);
  admin.twoFactorFailures = 5;
  const blocked = await verifySecondFactor({ ...admin }, totpCodeForStep(SECRET, STEP), { db, now: NOW });
  assert.equal(!blocked.ok && blocked.reason, "locked");
  assert.ok(admin.twoFactorLockedUntil && admin.twoFactorLockedUntil > NOW);
});
