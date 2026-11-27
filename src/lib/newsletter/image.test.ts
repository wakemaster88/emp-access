import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { encodeNewsletterImage, NEWSLETTER_IMAGE_MAX_BYTES, NEWSLETTER_IMAGE_WIDTH } from "./image";

function solid(width: number, height: number, channels: 3 | 4) {
  const background = channels === 4 ? { r: 26, g: 109, b: 115, alpha: 0.5 } : { r: 200, g: 120, b: 40 };
  return sharp({ create: { width, height, channels, background } });
}

test("Newsletter-Bild: AVIF wird JPEG mit 1200 px Breite, ohne Metadaten", async () => {
  const input = new Uint8Array(
    await solid(2400, 1600, 3).withMetadata({ exif: { IFD0: { Copyright: "Test" } } }).avif().toBuffer(),
  );
  const out = await encodeNewsletterImage(input);
  assert.ok(out);
  assert.equal(out.contentType, "image/jpeg");
  assert.equal(out.ext, "jpg");
  assert.equal(out.width, NEWSLETTER_IMAGE_WIDTH);
  assert.equal(out.height, 800);
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.exif, undefined);
});

test("Newsletter-Bild: kleine Bilder werden nicht vergrößert, Ausrichtung nach EXIF", async () => {
  const input = new Uint8Array(await solid(600, 400, 3).withMetadata({ orientation: 6 }).jpeg().toBuffer());
  const out = await encodeNewsletterImage(input);
  assert.ok(out);
  assert.equal(out.width, 400);
  assert.equal(out.height, 600);
});

test("Newsletter-Bild: Transparenz bleibt als PNG erhalten", async () => {
  const out = await encodeNewsletterImage(new Uint8Array(await solid(500, 100, 4).webp().toBuffer()));
  assert.ok(out);
  assert.equal(out.contentType, "image/png");
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.hasAlpha, true);
});

test("Newsletter-Bild: Unlesbares, Leeres und zu Großes wird abgelehnt", async () => {
  assert.equal(await encodeNewsletterImage(new Uint8Array(0)), null);
  const broken = new Uint8Array(500).fill(7);
  broken.set([0xff, 0xd8, 0xff]);
  assert.equal(await encodeNewsletterImage(broken), null);
  assert.equal(await encodeNewsletterImage(new Uint8Array(NEWSLETTER_IMAGE_MAX_BYTES + 1)), null);
  // Über 40 Megapixel
  assert.equal(await encodeNewsletterImage(new Uint8Array(await solid(8000, 6000, 3).png().toBuffer())), null);
});
