import { test } from "node:test";
import assert from "node:assert/strict";
import { ticketCreateSchema, ticketUpdateSchema } from "./validators";

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`;

test("ticketCreateSchema: Profilbild leer oder als Foto, sonst abgelehnt", () => {
  for (const profileImage of [undefined, null, "", jpeg]) {
    assert.equal(ticketCreateSchema.safeParse({ name: "Test", profileImage }).success, true);
  }
  for (const profileImage of ["kein Bild", "data:text/html;base64,PGI+eDwvYj4=", `data:image/jpeg;base64,${"A".repeat(400_001)}`]) {
    assert.equal(ticketCreateSchema.safeParse({ name: "Test", profileImage }).success, false);
  }
});

test("ticketUpdateSchema: Profilbild prüft die Route gegen den gespeicherten Wert", () => {
  assert.equal(ticketUpdateSchema.safeParse({ profileImage: "/api/foto/1" }).success, true);
  assert.equal(ticketUpdateSchema.safeParse({ name: "" }).success, false);
});
