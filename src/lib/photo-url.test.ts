import { test } from "node:test";
import assert from "node:assert/strict";
import { checkinPhotoUrl, decodeImageDataUrl } from "./photo-url";

test("checkinPhotoUrl: Token wird kodiert, Version haengt am Aenderungszeitpunkt", () => {
  const url = checkinPhotoUrl("ab/c", 12, new Date(1700000000000));
  assert.equal(url, "/api/checkin/public/ab%2Fc/photo/12?v=1700000000000");
});

test("decodeImageDataUrl: JPEG-Data-URL wird in Bytes zerlegt", () => {
  const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
  const decoded = decodeImageDataUrl(`data:image/jpeg;base64,${data}`);
  assert.equal(decoded?.contentType, "image/jpeg");
  assert.deepEqual([...(decoded?.bytes ?? [])], [0xff, 0xd8, 0xff, 0xe0]);
});

test("decodeImageDataUrl: SVG, HTML und Nicht-Data-URLs werden abgelehnt", () => {
  assert.equal(decodeImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), null);
  assert.equal(decodeImageDataUrl("data:text/html;base64,PGI+eDwvYj4="), null);
  assert.equal(decodeImageDataUrl("https://example.com/a.jpg"), null);
  assert.equal(decodeImageDataUrl("data:image/png;base64,"), null);
});

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`;

test("profilePhotoError: JPG, PNG und WebP bis zur Grenze, sonst ein Satz", async () => {
  const { PROFILE_PHOTO_MAX_CHARS, profilePhotoError } = await import("./photo-url");
  assert.equal(profilePhotoError(jpeg), null);
  assert.equal(profilePhotoError(jpeg.replace("image/jpeg", "image/png")), null);
  assert.equal(profilePhotoError(jpeg.replace("image/jpeg", "image/webp")), null);
  assert.ok(profilePhotoError(jpeg.replace("image/jpeg", "image/gif")));
  assert.ok(profilePhotoError("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="));
  assert.ok(profilePhotoError("https://example.com/a.jpg"));
  assert.ok(profilePhotoError("kein Bild"));
  // Groesstes heute gespeichertes Foto: gut 100.000 Zeichen.
  const big = `data:image/jpeg;base64,${"A".repeat(108_000)}`;
  assert.equal(profilePhotoError(big), null);
  const tooBig = `data:image/jpeg;base64,${"A".repeat(PROFILE_PHOTO_MAX_CHARS)}`;
  assert.equal(profilePhotoError(tooBig), "Das Bild ist zu groß.");
});

test("profilePhotoUpdate: fehlend, leer und unveraendert wie bisher, neue Bilder geprueft", async () => {
  const { profilePhotoUpdate } = await import("./photo-url");
  assert.deepEqual(profilePhotoUpdate(undefined, jpeg), {});
  assert.deepEqual(profilePhotoUpdate(null, jpeg), { value: null });
  assert.deepEqual(profilePhotoUpdate("", jpeg), { value: "" });
  assert.deepEqual(profilePhotoUpdate(jpeg, null), { value: jpeg });
  // Unveraendert zurueckgeschickt: auch ein Wert, der die Pruefung nicht bestuende.
  const legacy = "https://example.wakesys.com/foto.jpg";
  assert.deepEqual(profilePhotoUpdate(legacy, legacy), { value: legacy });
  // Eine Adresse statt eines Bildes aendert nichts.
  assert.deepEqual(profilePhotoUpdate("/api/checkin/public/x/photo/1?v=1", jpeg), {});
  assert.ok("error" in profilePhotoUpdate("data:text/html;base64,PGI+eDwvYj4=", jpeg));
  assert.ok("error" in profilePhotoUpdate(42, jpeg));
});

test("isPhotoRedirectTarget: nur https auf bekannten Foto-Hosts", async () => {
  const { isPhotoRedirectTarget } = await import("./photo-url");
  assert.equal(isPhotoRedirectTarget("https://konto.wakesys.com/bilder/1.jpg"), true);
  assert.equal(isPhotoRedirectTarget("https://abc123.public.blob.vercel-storage.com/x.jpg"), false);
  assert.equal(isPhotoRedirectTarget("http://konto.wakesys.com/bilder/1.jpg"), false);
  assert.equal(isPhotoRedirectTarget("https://wakesys.com.example.org/1.jpg"), false);
  assert.equal(isPhotoRedirectTarget("https://example.org/1.jpg"), false);
  assert.equal(isPhotoRedirectTarget("https://.wakesys.com/1.jpg"), false);
  assert.equal(isPhotoRedirectTarget("https://user:pw@konto.wakesys.com/1.jpg"), false);
  assert.equal(isPhotoRedirectTarget("kein link"), false);
});

test("profilePhotoAccepted: urteilt im Browser wie profilePhotoError auf dem Server", async () => {
  const { PROFILE_PHOTO_MAX_CHARS, profilePhotoAccepted, profilePhotoError } = await import("./photo-url");
  const cases = [
    jpeg,
    jpeg.replace("image/jpeg", "image/png"),
    jpeg.replace("image/jpeg", "image/webp"),
    jpeg.replace("image/jpeg", "image/gif"),
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:application/octet-stream;base64,/9j/4A==",
    "data:image/png;base64,",
    "https://example.com/a.jpg",
    "kein Bild",
    `data:image/jpeg;base64,${"A".repeat(108_000)}`,
    `data:image/jpeg;base64,${"A".repeat(PROFILE_PHOTO_MAX_CHARS)}`,
  ];
  for (const value of cases) {
    assert.equal(profilePhotoAccepted(value), profilePhotoError(value) === null, value.slice(0, 40));
  }
});
