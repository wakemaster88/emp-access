import { test } from "node:test";
import assert from "node:assert/strict";
import { maskScanCode, mcpScanNote } from "./scan-mask";

test("Code wird gekürzt mit Länge ausgegeben", () => {
  assert.deepEqual(maskScanCode("ABCDEF123456"), { code: "ABC…", length: 12 });
  assert.deepEqual(maskScanCode("1234"), { code: "12…", length: 4 });
  assert.deepEqual(maskScanCode("X"), { code: "…", length: 1 });
  assert.equal(maskScanCode(""), null);
  assert.equal(maskScanCode(null), null);
});

test("Notiz nur als fester Grund-Code", () => {
  assert.equal(mcpScanNote("ticket_not_found"), "ticket_not_found");
  assert.equal(mcpScanNote("binarytec_denied"), "binarytec_denied");
  assert.equal(mcpScanNote("reserved_code"), "reserved_code");
  assert.equal(mcpScanNote('{"name":"Test Person","age":30}'), null);
  assert.equal(mcpScanNote("Test Person"), null);
  assert.equal(mcpScanNote(null), null);
});
