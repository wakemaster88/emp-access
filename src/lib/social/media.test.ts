import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { encodeSocialImage, socialMediaPath, SOCIAL_IMAGE_PX } from "./media";

test("encodeSocialImage: JPEG, höchstens 1440 px, ohne Metadaten", async () => {
  const input = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 26, g: 109, b: 115, alpha: 0.5 } } })
    .png()
    .withMetadata({ exif: { IFD0: { Copyright: "Test" } } })
    .toBuffer();
  const out = await encodeSocialImage(new Uint8Array(input));
  assert.ok(out);
  const meta = await sharp(out!.bytes).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, SOCIAL_IMAGE_PX);
  assert.equal(meta.height, 960);
  assert.equal(meta.exif, undefined);
});

test("encodeSocialImage: keine Bilddatei", async () => {
  assert.equal(await encodeSocialImage(new TextEncoder().encode("kein Bild")), null);
});

test("socialMediaPath: Mandant im Pfad, zufälliger Teil", () => {
  const a = socialMediaPath(7, new Date("2026-12-06T10:00:00Z"));
  assert.match(a, /^social\/7\/20261206100000-[0-9a-f]{12}\.jpg$/);
  assert.notEqual(a, socialMediaPath(7, new Date("2026-12-06T10:00:00Z")));
});
