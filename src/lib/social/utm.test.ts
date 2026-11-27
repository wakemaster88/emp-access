import { test } from "node:test";
import assert from "node:assert/strict";
import type { NewsletterBlock } from "@/lib/newsletter/blocks";
import { hostKey, newsletterLink, socialLink, tagNewsletterBlocks, withUtm } from "./utm";

test("withUtm: hängt an, behält Pfad, Abfrage und Anker", () => {
  assert.equal(
    withUtm("https://www.tuttenbrocksee.com/wasserski?x=1#preise", { source: "instagram", medium: "social", campaign: "nikolaus-2026" }),
    "https://www.tuttenbrocksee.com/wasserski?x=1&utm_source=instagram&utm_medium=social&utm_campaign=nikolaus-2026#preise",
  );
});

test("withUtm: vorhandenes utm_ und Nicht-https bleiben", () => {
  const own = "https://anny.co/b/x?utm_source=newsletter&utm_campaign=nikolaus-2026";
  assert.equal(withUtm(own, { source: "a", medium: "b", campaign: "c" }), own);
  assert.equal(withUtm("http://a.de/", { source: "a", medium: "b", campaign: "c" }), "http://a.de/");
  assert.equal(withUtm("mailto:info@a.de", { source: "a", medium: "b", campaign: "c" }), "mailto:info@a.de");
  assert.equal(withUtm("kein link", { source: "a", medium: "b", campaign: "c" }), "kein link");
});

test("socialLink und newsletterLink", () => {
  assert.equal(socialLink("https://a.de/", "k", "FACEBOOK"), "https://a.de/?utm_source=facebook&utm_medium=social&utm_campaign=k");
  assert.equal(newsletterLink("https://a.de/", "k"), "https://a.de/?utm_source=newsletter&utm_medium=email&utm_campaign=k");
});

test("hostKey: ohne www, klein", () => {
  assert.equal(hostKey("https://WWW.Tuttenbrocksee.com/x"), "tuttenbrocksee.com");
  assert.equal(hostKey(null), null);
  assert.equal(hostKey("kaputt"), null);
});

test("tagNewsletterBlocks: nur eigene Website, nie /nl/ oder Abmelden, nie doppelt", () => {
  const blocks: NewsletterBlock[] = [
    { type: "heading", text: "Nikolaus" },
    { type: "text", text: "Infos [hier](https://www.tuttenbrocksee.com/nikolaus) und [anny](https://anny.co/b/x) und [ab](https://www.tuttenbrocksee.com/newsletter/abmelden?t=1)" },
    { type: "button", label: "Buchen", url: "https://tuttenbrocksee.com/buchen" },
    { type: "button", label: "Schon markiert", url: "https://www.tuttenbrocksee.com/?utm_source=newsletter&utm_campaign=x" },
    { type: "image", url: "https://bild.de/a.jpg", link: "https://www.emp-access.de/nl/abmelden" },
    { type: "image", url: "https://bild.de/b.jpg" },
    { type: "divider" },
  ];
  const out = tagNewsletterBlocks(blocks, "nikolaus-2026", ["tuttenbrocksee.com", null]);
  const tag = "utm_source=newsletter&utm_medium=email&utm_campaign=nikolaus-2026";
  assert.deepEqual(out[0], blocks[0]);
  assert.equal(
    (out[1] as { text: string }).text,
    `Infos [hier](https://www.tuttenbrocksee.com/nikolaus?${tag}) und [anny](https://anny.co/b/x) und [ab](https://www.tuttenbrocksee.com/newsletter/abmelden?t=1)`,
  );
  assert.equal((out[2] as { url: string }).url, `https://tuttenbrocksee.com/buchen?${tag}`);
  assert.deepEqual(out[3], blocks[3]);
  assert.deepEqual(out[4], blocks[4]);
  assert.deepEqual(out[5], blocks[5]);
  assert.deepEqual(out[6], blocks[6]);
  // Eingabe bleibt unverändert.
  assert.equal((blocks[2] as { url: string }).url, "https://tuttenbrocksee.com/buchen");
});

test("tagNewsletterBlocks: ohne Kürzel oder Rechner nichts ändern", () => {
  const blocks: NewsletterBlock[] = [{ type: "button", label: "x", url: "https://a.de/" }];
  assert.equal(tagNewsletterBlocks(blocks, "", ["a.de"]), blocks);
  assert.equal(tagNewsletterBlocks(blocks, "k", [null, undefined]), blocks);
});
