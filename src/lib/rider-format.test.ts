import { test } from "node:test";
import assert from "node:assert/strict";
import { voucherValidity } from "./rider-format";

test("voucherValidity: Datum bei langer Laufzeit, Countdown kurz vor Ablauf", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  assert.equal(voucherValidity(null, now), "ohne Ablauf");
  assert.match(voucherValidity(new Date("2027-11-21T12:00:00Z"), now), /^bis \d{2}\.\d{2}\.2027$/);
  assert.equal(voucherValidity(new Date("2026-12-01T12:00:00Z"), now), "noch 10 Tage");
});
