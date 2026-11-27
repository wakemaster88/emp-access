import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityImageView,
  classifyText,
  clipText,
  imageModeByName,
  isDuplicate,
  toolLabel,
  type ActivityEntry,
} from "./activity-rules.js";

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

test("Bilder in der Kachel KI nach Livebild und Vorschau der Kamera: automatisch, nur auf Tippen, aus", () => {
  const modeOf = imageModeByName([
    { name: "Kamera A", mode: "auto" },
    { name: "Kamera B", mode: "click" },
    { name: "Kamera C", mode: "off" },
  ]);
  // Waechter und Alarme nennen die Kamera in `where`.
  assert.equal(activityImageView({ kind: "watch", where: "Kamera A" }, modeOf), "show");
  assert.equal(activityImageView({ kind: "alert", where: "Kamera B" }, modeOf), "tap");
  assert.equal(activityImageView({ kind: "detect", where: "Kamera C" }, modeOf), "hide");
  // Telegram-Bilder tragen sie in `camera`.
  assert.equal(activityImageView({ kind: "alert", camera: "Kamera C" }, modeOf), "hide");
  assert.equal(activityImageView({ kind: "message", camera: "Kamera B" }, modeOf), "tap");
  // Bei Nachrichten von Personen ist `where` der Absender, keine Kamera.
  assert.equal(activityImageView({ kind: "user", where: "Kamera C" }, modeOf), "show");
  // Ohne Kamera oder mit unbekanntem Namen: erst auf Tippen, solange eine
  // Kamera nicht auf automatisch steht (aeltere Eintraege, Umbenennung).
  assert.equal(activityImageView({ kind: "alert" }, modeOf), "tap");
  assert.equal(activityImageView({ kind: "alert", where: "Kamera X" }, modeOf), "tap");
  // Bilder von Personen ohne Kamera bleiben.
  assert.equal(activityImageView({ kind: "user" }, modeOf), "show");
  // Ohne Einstellungen wie bisher.
  assert.equal(activityImageView({ kind: "alert", where: "Kamera C" }, () => null), "show");
});

test("Alle Kameras automatisch: Eintraege ohne bekannte Kamera zeigen ihr Bild wie bisher", () => {
  const modeOf = imageModeByName([
    { name: "Kamera A", mode: "auto" },
    { name: "Kamera B", mode: "auto" },
  ]);
  assert.equal(activityImageView({ kind: "alert" }, modeOf), "show");
  assert.equal(activityImageView({ kind: "watch", where: "Kamera X" }, modeOf), "show");
  assert.equal(activityImageView({ kind: "watch", where: "Kamera A" }, modeOf), "show");
});

test("Gleicher Kameraname zweimal: die strengere Einstellung gilt", () => {
  const modeOf = imageModeByName([
    { name: "Kamera A", mode: "auto" },
    { name: "Kamera A ", mode: "off" },
    { name: "Kamera B", mode: "click" },
    { name: "Kamera B", mode: "auto" },
  ]);
  assert.equal(modeOf("Kamera A"), "off");
  assert.equal(modeOf("Kamera B"), "click");
  assert.equal(modeOf("Kamera C"), "click");
});
