import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, renderTemplateHtml } from "./email-templates";

const vars = {
  firstName: '<a href="https://example.test">Jetzt bestätigen</a>',
  lastName: "O'Neil & Co",
  renewUrl: "https://example.test/abo?x=1&y=2",
  endDate: null,
};

test("renderTemplateHtml maskiert eingesetzte Werte", () => {
  assert.equal(
    renderTemplateHtml("<p>Hallo {{firstName}} {{ lastName }},</p>", vars),
    "<p>Hallo &lt;a href=&quot;https://example.test&quot;&gt;Jetzt bestätigen&lt;/a&gt; O&#39;Neil &amp; Co,</p>",
  );
});

test("renderTemplateHtml laesst das HTML der Vorlage und Links gueltig", () => {
  assert.equal(
    renderTemplateHtml('<a href="{{renewUrl}}">Abo</a>{{endDate}}{{unbekannt}}', vars),
    '<a href="https://example.test/abo?x=1&amp;y=2">Abo</a>',
  );
});

test("renderTemplate setzt Werte fuer den Betreff unveraendert ein", () => {
  assert.equal(renderTemplate("Hallo {{lastName}}", vars), "Hallo O'Neil & Co");
});
