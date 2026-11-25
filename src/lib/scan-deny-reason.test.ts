import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isScanDenyReasonCode,
  parseScanDisplayNote,
  scanDenyReasonLabel,
} from "./scan-deny-reason";

test("partner_timeout ist ein Reason-Code mit eigenem Text", () => {
  assert.equal(isScanDenyReasonCode("partner_timeout"), true);
  assert.equal(scanDenyReasonLabel("partner_timeout"), "Partner-System antwortet nicht rechtzeitig");
  assert.deepEqual(parseScanDisplayNote("partner_timeout"), {});
});

test("bestehende Codes bleiben unveraendert", () => {
  assert.equal(scanDenyReasonLabel("ticket_not_found"), "Ticket nicht gefunden");
  assert.equal(scanDenyReasonLabel("binarytec_denied"), "Binarytec verweigert");
});
