import { test } from "node:test";
import assert from "node:assert/strict";

test("ticketClaimKey: gilt nur für genau dieses Ticket", async () => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  const { ticketClaimKey, verifyTicketClaimKey } = await import("./day-guest");
  const key = ticketClaimKey(4711);
  assert.equal(verifyTicketClaimKey(key), 4711);
  assert.equal(verifyTicketClaimKey(key.replace("4711.", "4712.")), null);
  assert.equal(verifyTicketClaimKey(key.slice(0, -1) + (key.endsWith("A") ? "B" : "A")), null);
  assert.equal(verifyTicketClaimKey("4711"), null);
  assert.equal(verifyTicketClaimKey(""), null);
});
