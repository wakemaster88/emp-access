import { test } from "node:test";
import assert from "node:assert/strict";

// lib/prisma nimmt außerhalb der Produktion den Client aus `globalThis.prisma`;
// der Filter selbst fragt nichts ab.
(globalThis as unknown as { prisma: unknown }).prisma = {};

test("ticketEmailWhere: bis zur Obergrenze über die IDs", async () => {
  const { MAX_EMAIL_TICKET_IDS, ticketEmailWhere } = await import("./ticket-email");
  assert.deepEqual(ticketEmailWhere([3, 2, 1], "a@example.org"), { id: { in: [3, 2, 1] } });
  assert.deepEqual(ticketEmailWhere([], "a@example.org"), { id: { in: [] } });
  const full = Array.from({ length: MAX_EMAIL_TICKET_IDS }, (_, i) => i + 1);
  assert.deepEqual(ticketEmailWhere(full, "a@example.org"), { id: { in: full } });
});

test("ticketEmailWhere: darüber Vergleich der Adresse, Sonderzeichen wörtlich", async () => {
  const { MAX_EMAIL_TICKET_IDS, ticketEmailWhere } = await import("./ticket-email");
  const many = Array.from({ length: MAX_EMAIL_TICKET_IDS + 1 }, (_, i) => i + 1);
  assert.deepEqual(ticketEmailWhere(many, "a_b%c@example.org"), {
    email: { equals: "a\\_b\\%c@example.org", mode: "insensitive" },
  });
  assert.ok(MAX_EMAIL_TICKET_IDS < 32_000);
});
