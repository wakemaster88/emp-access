import { test } from "node:test";
import assert from "node:assert/strict";
import { sendToAllChats } from "./surveillance-send";

test("sendToAllChats: alle Chats nebeneinander, nicht nacheinander", async () => {
  let active = 0;
  let most = 0;
  const release: Array<() => void> = [];
  const done = sendToAllChats(
    ["Chat A", "Chat B", "Chat C"],
    async () => {
      active++;
      most = Math.max(most, active);
      await new Promise<void>((r) => release.push(r));
      active--;
      return { ok: true };
    },
    () => assert.fail("kein Chat scheitert"),
  );
  // Alle drei Sendungen laufen, bevor die erste fertig ist.
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(release.length, 3);
  for (const r of release) r();
  assert.equal(await done, 3);
  assert.equal(most, 3);
});

test("sendToAllChats: ein gescheiterter Chat hält die anderen nicht auf", async () => {
  const failed: string[] = [];
  const sent = await sendToAllChats(
    ["Chat A", "Chat B", "Chat C"],
    async (chat) => {
      if (chat === "Chat A") throw new Error("Zeitüberschreitung");
      if (chat === "Chat B") return { ok: false, description: "Forbidden: bot was blocked by the user" };
      return { ok: true };
    },
    (chat, why) => failed.push(`${chat}: ${why.description ?? (why.error instanceof Error ? why.error.message : "")}`),
  );
  assert.equal(sent, 1);
  assert.deepEqual(failed.sort(), ["Chat A: Zeitüberschreitung", "Chat B: Forbidden: bot was blocked by the user"]);
});

test("sendToAllChats: ohne Chats nichts gesendet", async () => {
  assert.equal(await sendToAllChats([], async () => ({ ok: true }), () => undefined), 0);
});
