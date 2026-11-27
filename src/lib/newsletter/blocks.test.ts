import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmMailBlocks, inlineHtml, inlineText, isLinkUrl, parseBlocks, renderNewsletterHtml, renderNewsletterText, textOn,
} from "./blocks";
import { publicPageHtml } from "./public-page";

test("parseBlocks: gültige Bausteine, leere Texte fallen weg", () => {
  const r = parseBlocks([
    { type: "heading", text: "  Saisonstart  " },
    { type: "text", text: "" },
    { type: "text", text: "Hallo\r\nWelt" },
    { type: "image", url: "https://example.com/a.jpg", alt: "Lift", link: "https://example.com" },
    { type: "button", label: "Jetzt buchen", url: "https://example.com/buchen" },
    { type: "divider" },
  ]);
  assert.ok("blocks" in r);
  assert.deepEqual(r.blocks, [
    { type: "heading", text: "Saisonstart" },
    { type: "text", text: "Hallo\nWelt" },
    { type: "image", url: "https://example.com/a.jpg", alt: "Lift", link: "https://example.com" },
    { type: "button", label: "Jetzt buchen", url: "https://example.com/buchen" },
    { type: "divider" },
  ]);
});

test("parseBlocks: unsichere Adressen und unbekannte Arten werden abgelehnt", () => {
  assert.ok("error" in parseBlocks([{ type: "image", url: "http://example.com/a.jpg" }]));
  assert.ok("error" in parseBlocks([{ type: "button", label: "x", url: "javascript:alert(1)" }]));
  assert.ok("error" in parseBlocks([{ type: "script" }]));
  assert.ok("error" in parseBlocks("kein Array"));
  assert.ok("error" in parseBlocks(Array.from({ length: 41 }, () => ({ type: "divider" }))));
});

test("inlineHtml: maskiert HTML, setzt fett und sichere Links", () => {
  assert.equal(
    inlineHtml("<b>x</b> **neu** [Buchen](https://a.de/b?x=1&y=2) [böse](javascript:alert(1))", "#000000"),
    '&lt;b&gt;x&lt;/b&gt; <strong>neu</strong> <a href="https://a.de/b?x=1&amp;y=2" style="color:#000000;text-decoration:underline;">Buchen</a> [böse](javascript:alert(1))',
  );
});

test("inlineText: Links als Text mit Adresse", () => {
  assert.equal(inlineText("**Neu:** [Buchen](https://a.de)"), "Neu: Buchen (https://a.de)");
});

test("isLinkUrl: https, mailto und tel", () => {
  assert.ok(isLinkUrl("https://tuttenbrocksee.com"));
  assert.ok(isLinkUrl("mailto:info@tuttenbrocksee.com"));
  assert.ok(isLinkUrl("tel:+49 2521 123"));
  assert.ok(!isLinkUrl("http://tuttenbrocksee.com"));
  assert.ok(!isLinkUrl("javascript:alert(1)"));
});

test("renderNewsletterHtml: Abmeldelink, Pflichtangaben und Vorschauzeile", () => {
  const html = renderNewsletterHtml([{ type: "text", text: "Hallo" }], {
    brand: { accountName: "Tuttenbrocksee", color: "#1a6d73", legalFooter: "Firma GmbH\nStraße 1" },
    preheader: "Neue Angebote",
    unsubscribeUrl: "https://example.com/abmelden?t=abc",
    reason: "Du bekommst diese Mail, weil du den Newsletter bestellt hast.",
  });
  assert.match(html, /Newsletter abbestellen/);
  assert.match(html, /href="https:\/\/example.com\/abmelden\?t=abc"/);
  assert.match(html, /Firma GmbH<br>Straße 1/);
  assert.match(html, /Neue Angebote/);
  assert.doesNotMatch(html, /<script/i);
});

test("renderNewsletterText: Abmeldelink im Text", () => {
  const text = renderNewsletterText([{ type: "heading", text: "Neu" }, { type: "button", label: "Buchen", url: "https://a.de" }], {
    brand: { accountName: "X" },
    unsubscribeUrl: "https://example.com/abmelden",
  });
  assert.match(text, /^NEU\n\nBuchen: https:\/\/a.de/);
  assert.match(text, /Newsletter abbestellen: https:\/\/example.com\/abmelden/);
});

test("confirmMailBlocks: Taste mit dem Bestätigungslink", () => {
  const blocks = confirmMailBlocks("Tuttenbrocksee", "https://example.com/c");
  assert.ok(blocks.some((b) => b.type === "button" && b.url === "https://example.com/c"));
});

test("renderNewsletterHtml: Website-Design mit Logo, Akzentlinie und großer erster Überschrift", () => {
  const html = renderNewsletterHtml(
    [
      { type: "heading", text: "Nikolausfahren" },
      { type: "text", text: "Am 6. Dezember" },
      { type: "heading", text: "Kostüm" },
      { type: "button", label: "Mehr", url: "https://a.de" },
    ],
    { brand: { accountName: "TwinCable", logoUrl: "https://x.de/logo.png", websiteUrl: "https://www.tuttenbrocksee.com" } },
  );
  assert.match(html, /<img src="https:\/\/x.de\/logo.png" alt="TwinCable"/);
  assert.match(html, /border-bottom:4px solid #fbbf24/);
  assert.match(html, /<h1 class="nl-h1"[^>]*>Nikolausfahren<\/h1>/);
  assert.match(html, /<h2[^>]*>Kostüm<\/h2>/);
  assert.match(html, /background:#1a6d73;"><a href="https:\/\/a.de" style="[^"]*color:#ffffff/);
  assert.match(html, />tuttenbrocksee.com<\/a>/);
  assert.match(html, /@media only screen and \(max-width:620px\)/);
  assert.doesNotMatch(html, /fonts.googleapis/);
});

test("renderNewsletterHtml: erstes Bild randlos als Titelbild, eigene Farben", () => {
  const html = renderNewsletterHtml(
    [{ type: "image", url: "https://x.de/a.jpg", alt: "See" }, { type: "text", text: "Hallo" }, { type: "image", url: "https://x.de/b.jpg" }],
    { brand: { accountName: "X", color: "#fbbf24", accentColor: "#ff0000" } },
  );
  assert.match(html, /<img src="https:\/\/x.de\/a.jpg" alt="See" width="600"/);
  assert.match(html, /<img src="https:\/\/x.de\/b.jpg" alt="" width="536"/);
  assert.match(html, /border-bottom:4px solid #ff0000/);
  // Ohne Logo steht der Name im Kopf.
  assert.match(html, /font-weight:700;color:#0f172a;">X<\/div>/);
});

test("textOn: weiße Schrift auf Petrol, dunkle auf Gelb", () => {
  assert.equal(textOn("#1a6d73"), "#ffffff");
  assert.equal(textOn("#fbbf24"), "#0f172a");
  assert.equal(textOn("#4f46e5"), "#ffffff");
});

test("publicPageHtml: Logo, Akzentlinie und Taste in der Hauptfarbe", () => {
  const html = publicPageHtml({
    title: "Newsletter abbestellen",
    lines: ["Text"],
    emailForm: { label: "Abmeldelink schicken" },
    brand: { accountName: "TwinCable", logoUrl: "https://x.de/logo.png", websiteUrl: "https://www.tuttenbrocksee.com" },
  });
  assert.match(html, /<a href="https:\/\/www.tuttenbrocksee.com"><img src="https:\/\/x.de\/logo.png" alt="TwinCable"/);
  assert.match(html, /border-bottom:4px solid #fbbf24/);
  assert.match(html, /background:#1a6d73;color:#ffffff/);
  assert.doesNotMatch(html, /<script/i);
});
