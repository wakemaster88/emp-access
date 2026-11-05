import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyText, clipText, isDuplicate, toolLabel, type ActivityEntry } from "./activity-rules.js";

test("Telegram-Texte bekommen ihre Art aus dem Anfang", () => {
  assert.equal(classifyText("‼️ Cloud nicht erreichbar"), "alert");
  assert.equal(classifyText("⚠️ Halle, 23:10: Person am Tor"), "warn");
  assert.equal(classifyText("✅ Wieder in Ordnung: Kamera Gastro"), "ok");
  assert.equal(classifyText("Erledigt: Licht Halle an"), "action");
  assert.equal(classifyText("Fehlgeschlagen: Sirene – Zeitüberschreitung"), "error");
  assert.equal(classifyText("Soll ich das ausführen?\n• Licht an"), "suggest");
  assert.equal(classifyText("Mähen heute empfohlen", true), "suggest");
  assert.equal(classifyText("Tagesbericht 5.11.2026\n\nAlles ruhig."), "message");
});

test("Gleiche Nachricht an zwei Chats nur einmal", () => {
  const now = Date.parse("2026-11-05T16:00:00Z");
  const recent: ActivityEntry[] = [{ id: 1, at: new Date(now - 2_000).toISOString(), kind: "warn", text: "⚠️ X" }];
  assert.equal(isDuplicate(recent, "warn", "⚠️ X", now), true);
  assert.equal(isDuplicate(recent, "warn", "⚠️ Y", now), false);
  assert.equal(isDuplicate(recent, "warn", "⚠️ X", now + 60_000), false);
});

test("Lange Texte werden gekuerzt, Werkzeuge lesbar", () => {
  const long = "Zeile\n".repeat(200);
  assert.ok(clipText(long).length <= 602);
  assert.ok(clipText(long).endsWith("…"));
  assert.equal(toolLabel("hub_status"), "Lage des Hubs");
  assert.equal(toolLabel("look_at_camera", { camera: "Halle" }), "Kamerabild Halle");
  assert.equal(toolLabel("set_device"), "set device");
});
