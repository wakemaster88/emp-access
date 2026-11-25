import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { encodeChallengePhoto, encodeChallengeThumb } from "./challenge-photo-encode";
import { CHALLENGE_PHOTO_PX, CHALLENGE_THUMB_PX } from "./challenge-voting-rules";

async function photo(width: number, height: number, format: "jpeg" | "png", orientation?: number) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  if (orientation) img = img.withMetadata({ orientation, exif: { IFD0: { Copyright: "Test" } } });
  return new Uint8Array(await (format === "jpeg" ? img.jpeg() : img.png()).toBuffer());
}

test("Challenge-Foto: auf 1600 px verkleinert, nach EXIF gedreht, ohne Metadaten", async () => {
  const input = await photo(3000, 2000, "jpeg", 6);
  const out = await encodeChallengePhoto(input);
  assert.ok(out);
  assert.equal(out.contentType, "image/jpeg");
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.format, "jpeg");
  // Ausrichtung 6 = 90° gedreht: aus quer wird hoch.
  assert.equal(meta.height, CHALLENGE_PHOTO_PX);
  assert.ok((meta.width ?? 0) < (meta.height ?? 0));
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
});

test("Challenge-Foto: kleine PNG werden JPEG und nicht vergrößert", async () => {
  const out = await encodeChallengePhoto(await photo(400, 300, "png"));
  assert.ok(out);
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 300);
});

test("Challenge-Foto: über 40 Megapixel und Unlesbares werden abgelehnt", async () => {
  assert.equal(await encodeChallengePhoto(await photo(8000, 6000, "png")), null);
  const broken = new Uint8Array(200).fill(7);
  broken.set([0xff, 0xd8, 0xff]);
  assert.equal(await encodeChallengePhoto(broken), null);
});

test("Vorschaubild: höchstens 480 px", async () => {
  const thumb = await encodeChallengeThumb(await photo(1600, 1200, "jpeg"));
  assert.ok(thumb);
  const meta = await sharp(thumb.bytes).metadata();
  assert.equal(meta.width, CHALLENGE_THUMB_PX);
});
