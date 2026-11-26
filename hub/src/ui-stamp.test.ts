import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UI_META_PLACEHOLDER, assetEtag, uiHtmlEtag, uiStampFromEtags, withUiStamp } from "./ui-stamp.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("ETag aus Größe und Änderungszeit", () => {
  assert.equal(assetEtag({ size: 1234, mtimeMs: 1700000000123.9 }), 'W/"1234-1700000000123"');
});

test("Stand folgt jeder Datei der Oberfläche", () => {
  const tags = ['W/"10-1"', 'W/"20-2"', 'W/"30-3"', 'W/"40-4"'];
  const stamp = uiStampFromEtags(tags);
  assert.match(stamp, /^[0-9a-f]{12}$/);
  assert.equal(uiStampFromEtags([...tags]), stamp);
  for (let i = 0; i < tags.length; i++) {
    const changed = tags.map((t, j) => (j === i ? 'W/"11-9"' : t));
    assert.notEqual(uiStampFromEtags(changed), stamp, `Datei ${i}`);
  }
});

test("Seite trägt den Stand, mit dem sie ausgeliefert wurde", () => {
  const html = `<head>\n${UI_META_PLACEHOLDER}\n</head>`;
  assert.equal(withUiStamp(html, "0123456789ab"), '<head>\n<meta name="hub-ui" content="0123456789ab">\n</head>');
  // Ungültiger Stand oder fehlender Platzhalter: Seite unverändert.
  assert.equal(withUiStamp(html, '"><script>'), html);
  assert.equal(withUiStamp(html, ""), html);
  assert.equal(withUiStamp("<head></head>", "0123456789ab"), "<head></head>");
  assert.equal(uiHtmlEtag("0123456789ab"), 'W/"ui-0123456789ab"');
});

test("dashboard.html hat den Platzhalter genau einmal, im Kopf", () => {
  const html = readFileSync(path.join(here, "ui", "dashboard.html"), "utf8");
  assert.equal(html.split(UI_META_PLACEHOLDER).length, 2);
  assert.ok(html.indexOf(UI_META_PLACEHOLDER) < html.indexOf("</head>"));
  assert.ok(html.indexOf(UI_META_PLACEHOLDER) < html.indexOf("/dashboard.js"));
});
