import assert from "node:assert/strict";
import { test } from "node:test";
import { requestTelegramText, VEREIN_REQUEST_CALLBACK_RE } from "./verein-request-telegram";

test("Telegram-Text der Anfrage escaped HTML und zeigt Name und Bemerkung", () => {
  const text = requestTelegramText({
    vereinName: "WSC <Nord>",
    serviceName: "Übungslift",
    date: "2026-11-11",
    slotStart: "10:00",
    slotEnd: "11:00",
    priceCents: 4550,
    bookedBy: "Jan & Mia",
    note: "Jugend",
  });
  assert.match(text, /Anfrage von WSC &lt;Nord&gt;/);
  assert.match(text, /Übungslift · 11\.11\.2026, 10:00–11:00 Uhr/);
  assert.match(text, /Jan &amp; Mia/);
  assert.match(text, /„Jugend“/);
});

test("Callback-Daten der Tasten", () => {
  assert.deepEqual("vreq:ok:42".match(VEREIN_REQUEST_CALLBACK_RE)?.slice(1), ["ok", "42"]);
  assert.deepEqual("vreq:no:7".match(VEREIN_REQUEST_CALLBACK_RE)?.slice(1), ["no", "7"]);
  assert.equal(VEREIN_REQUEST_CALLBACK_RE.test("vreq:ok:x"), false);
});
