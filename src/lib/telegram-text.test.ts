import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeTelegramHtml, truncateTelegramLines, TELEGRAM_MESSAGE_LIMIT } from "./telegram-text";

test("escapeTelegramHtml maskiert &, < und >", () => {
  assert.equal(escapeTelegramHtml("Kinder <12 & Eltern >18"), "Kinder &lt;12 &amp; Eltern &gt;18");
  assert.equal(escapeTelegramHtml('<a href="x">Link</a>'), '&lt;a href="x"&gt;Link&lt;/a&gt;');
  assert.equal(escapeTelegramHtml("Anna Müller"), "Anna Müller");
});

test("truncateTelegramLines laesst kurze Nachrichten unveraendert", () => {
  const text = "<b>Kopf</b>\n  • Zeile";
  assert.equal(truncateTelegramLines(text), text);
});

test("truncateTelegramLines kuerzt am Zeilenende und haengt … an", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `  • <b>Person ${i}</b> (Abo)`);
  const text = lines.join("\n");
  const out = truncateTelegramLines(text);
  assert.ok(out.length <= TELEGRAM_MESSAGE_LIMIT);
  assert.ok(out.endsWith("\n…"));
  const kept = out.slice(0, -2).split("\n");
  // jede behaltene Zeile ist eine vollstaendige Originalzeile
  for (const [i, line] of kept.entries()) assert.equal(line, lines[i]);
});

test("truncateTelegramLines beachtet eine eigene Grenze", () => {
  const out = truncateTelegramLines("aaaa\nbbbb\ncccc", 11);
  assert.equal(out, "aaaa\nbbbb\n…");
  assert.equal(truncateTelegramLines("aaaa\nbbbb\ncccc", 10), "aaaa\n…");
});
