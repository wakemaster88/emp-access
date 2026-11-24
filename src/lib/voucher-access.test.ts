import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVoucherAccess } from "./voucher-access";
import { scanDenyReasonLabel } from "./scan-deny-reason";

const now = new Date("2026-07-01T10:00:00Z");
const base = { kind: "ACCESS", redeemedAt: null, disabledAt: null, expiresAt: null };

test("offener Zutritts-Gutschein ohne Verfallsdatum ist einlösbar", () => {
  assert.deepEqual(checkVoucherAccess(base, now), { ok: true });
});

test("Zutritts-Gutschein mit Verfallsdatum in der Zukunft ist einlösbar", () => {
  assert.deepEqual(checkVoucherAccess({ ...base, expiresAt: new Date("2026-07-02T00:00:00Z") }, now), { ok: true });
});

test("Leistungs-Gutschein gibt nie Zutritt", () => {
  const r = checkVoucherAccess({ ...base, kind: "BENEFIT" }, now);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "benefit");
  assert.equal(!r.ok && r.message, "Gutschein gilt nur an der Kasse");
  assert.equal(!r.ok && r.note, "voucher_benefit_only");
});

test("deaktivierter Gutschein wird abgelehnt, auch vor 'eingelöst'", () => {
  const r = checkVoucherAccess({ ...base, disabledAt: now, redeemedAt: now }, now);
  assert.equal(!r.ok && r.reason, "disabled");
  assert.equal(!r.ok && r.message, "Gutschein wurde deaktiviert");
  assert.equal(!r.ok && r.note, "voucher_disabled");
});

test("eingelöster Gutschein wird abgelehnt", () => {
  const r = checkVoucherAccess({ ...base, redeemedAt: now }, now);
  assert.equal(!r.ok && r.reason, "redeemed");
  assert.equal(!r.ok && r.message, "Gutschein bereits eingelöst");
  assert.equal(!r.ok && r.note, "voucher_already_redeemed");
});

test("Gutschein gilt bis zum Ende des genannten Tages (Berlin)", () => {
  // Mail-Regel: Ablauf = Tagesanfang, in der Mail steht „Gültig bis 23.01.2027“.
  const expiresAt = new Date("2027-01-23T00:00:00Z");
  assert.deepEqual(checkVoucherAccess({ ...base, expiresAt }, new Date("2027-01-23T10:00:00Z")), { ok: true });
  assert.deepEqual(checkVoucherAccess({ ...base, expiresAt }, new Date("2027-01-23T22:59:00Z")), { ok: true });
  // 24.01. 00:30 Uhr in Berlin: vorbei.
  const late = checkVoucherAccess({ ...base, expiresAt }, new Date("2027-01-23T23:30:00Z"));
  assert.equal(!late.ok && late.reason, "expired");
  // Ablauf genau jetzt: gilt noch.
  assert.deepEqual(checkVoucherAccess({ ...base, expiresAt: now }, now), { ok: true });
});

test("abgelaufener Gutschein wird abgelehnt", () => {
  const r = checkVoucherAccess({ ...base, expiresAt: new Date("2026-06-30T12:00:00Z") }, now);
  assert.equal(!r.ok && r.reason, "expired");
  assert.equal(!r.ok && r.message, "Gutschein abgelaufen");
  assert.equal(!r.ok && r.note, "voucher_expired");
});

test("alle Ablehnungs-Codes haben einen Text für Personal/Monitor", () => {
  for (const v of [
    { ...base, kind: "BENEFIT" },
    { ...base, disabledAt: now },
    { ...base, redeemedAt: now },
    { ...base, expiresAt: new Date("2026-01-01T00:00:00Z") },
  ]) {
    const r = checkVoucherAccess(v, now);
    assert.equal(r.ok, false);
    if (!r.ok) assert.notEqual(scanDenyReasonLabel(r.note), r.note);
  }
});
