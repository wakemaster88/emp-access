import { test } from "node:test";
import assert from "node:assert/strict";
import { lanUnreachable } from "./shelly-lan";

test("lanUnreachable: nur auf Vercel", () => {
  assert.equal(lanUnreachable({ VERCEL: "1" }), true);
  assert.equal(lanUnreachable({}), false);
  assert.equal(lanUnreachable({ VERCEL: "" }), false);
});
