import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUTE_IMAGE_PREFIXES,
  articleImageUrl,
  checkinLostItemImageUrl,
  countLineImageUrl,
  dropImageRouteRef,
  isImageRouteRef,
  isUploadImageDataUrl,
  listImageSrcs,
  lostItemImageUrl,
  wantsImageUrls,
} from "./list-images";
import { decodeImageDataUrl } from "./photo-url";
import { lostItemImageUpdateError } from "./lost-item-data";
import { lostItemCreateSchema, lostItemUpdateSchema } from "./validators";

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`;

test("listImageSrcs: Route für normale Fotos, gespeicherter Wert für Sonderfälle, ohne Bild nichts", () => {
  const srcs = listImageSrcs(
    [{ id: 1 }, { id: 2 }, { id: 3 }],
    [{ id: 2, image: "https://images.example.org/a.jpg" }, { id: 3, image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }],
    (id) => `/route/${id}`,
  );
  assert.equal(srcs.get(1), "/route/1");
  assert.equal(srcs.get(2), "https://images.example.org/a.jpg");
  assert.equal(srcs.get(3), "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
  assert.equal(srcs.has(4), false);
});

test("ROUTE_IMAGE_PREFIXES: deckt genau die Typen ab, die die Route ausliefert", () => {
  // Jedes Präfix, das die Liste über die Route zeigt, muss die Route auch zerlegen können.
  for (const prefix of ROUTE_IMAGE_PREFIXES) {
    assert.ok(decodeImageDataUrl(`${prefix}${jpeg.split(",")[1]}`), prefix);
  }
});

test("Bild-Adressen tragen Version und kodieren das Token", () => {
  const at = new Date(1700000000000);
  assert.equal(lostItemImageUrl(5, at), "/api/lost-items/5/image?v=1700000000000");
  assert.equal(checkinLostItemImageUrl("a/b", 5, at), "/api/checkin/public/a%2Fb/lost-items/5/image?v=1700000000000");
  assert.equal(articleImageUrl(7, at), "/api/warenwirtschaft/articles/7/image?v=1700000000000");
  assert.equal(countLineImageUrl("x y", 9, at), "/api/zaehlen/x%20y/image?id=9&v=1700000000000");
  for (const url of [lostItemImageUrl(5, at), articleImageUrl(7, at), countLineImageUrl("t", 9, at)]) {
    assert.equal(isImageRouteRef(url), true);
  }
});

test("wantsImageUrls: nur mit fotos=url", () => {
  assert.equal(wantsImageUrls(new URLSearchParams("fotos=url")), true);
  assert.equal(wantsImageUrls(new URLSearchParams("")), false);
  assert.equal(wantsImageUrls(new URLSearchParams("fotos=1")), false);
});

test("dropImageRouteRef: nur die Adresse der Bild-Route fällt weg", () => {
  assert.deepEqual(dropImageRouteRef({ image: "/api/lost-items/1/image?v=1", pickedUp: true }), { pickedUp: true });
  assert.deepEqual(dropImageRouteRef({ image: jpeg }), { image: jpeg });
  assert.deepEqual(dropImageRouteRef({ image: null }), { image: null });
  assert.deepEqual(dropImageRouteRef({ image: "https://images.example.org/a.jpg" }), { image: "https://images.example.org/a.jpg" });
  assert.equal(dropImageRouteRef(null), null);
});

test("isUploadImageDataUrl: JPG, PNG, WebP als Base64", () => {
  assert.equal(isUploadImageDataUrl(jpeg), true);
  assert.equal(isUploadImageDataUrl(jpeg.replace("jpeg", "png")), true);
  assert.equal(isUploadImageDataUrl(jpeg.replace("jpeg", "webp")), true);
  assert.equal(isUploadImageDataUrl(jpeg.replace("jpeg", "gif")), false);
  assert.equal(isUploadImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), false);
  assert.equal(isUploadImageDataUrl("data:image/jpeg,rohtext"), false);
  assert.equal(isUploadImageDataUrl("https://images.example.org/a.jpg"), false);
  // Groß geschriebener Typ: kein Präfix der Bild-Route, deshalb abgelehnt.
  assert.equal(isUploadImageDataUrl(jpeg.replace("jpeg", "JPEG")), false);
  assert.equal(isUploadImageDataUrl(jpeg.replace("data:image", "DATA:IMAGE")), false);
  // Was als Upload durchgeht, beginnt mit einem Präfix der Bild-Route.
  for (const t of ["jpeg", "png", "webp"]) {
    const v = jpeg.replace("jpeg", t);
    assert.equal(isUploadImageDataUrl(v) && ROUTE_IMAGE_PREFIXES.some((p) => v.startsWith(p)), true, t);
  }
});

test("lostItemCreateSchema: neues Bild nur als Foto, Größe wie bisher bis 2.000.000 Zeichen", () => {
  const base = { description: "Jacke", foundDate: "2026-06-12" };
  for (const image of [undefined, null, jpeg]) {
    assert.equal(lostItemCreateSchema.safeParse({ ...base, image }).success, true, String(image));
  }
  // Ein großes Foto, wie es die Kamera mit 1024 px liefern kann, bleibt erlaubt.
  const big = `data:image/jpeg;base64,${"A".repeat(1_500_000)}`;
  assert.equal(lostItemCreateSchema.safeParse({ ...base, image: big }).success, true);
  assert.equal(lostItemCreateSchema.safeParse({ ...base, image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }).success, false);
  assert.equal(lostItemCreateSchema.safeParse({ ...base, image: `data:image/jpeg;base64,${"A".repeat(2_000_000)}` }).success, false);
});

test("lostItemImageUpdateError: unverändertes Bild bleibt erlaubt, neues muss ein Foto sein", () => {
  const legacy = "data:image/heic;base64,AAAA";
  // Das Schema für Änderungen nimmt das gespeicherte Bild weiter an ...
  assert.equal(lostItemUpdateSchema.safeParse({ image: legacy }).success, true);
  // ... und die Prüfung gegen den gespeicherten Wert lässt es durch.
  assert.equal(lostItemImageUpdateError(legacy, legacy), null);
  assert.equal(lostItemImageUpdateError(undefined, legacy), null);
  assert.equal(lostItemImageUpdateError(null, legacy), null);
  assert.equal(lostItemImageUpdateError(jpeg, legacy), null);
  assert.ok(lostItemImageUpdateError(legacy, null));
  assert.ok(lostItemImageUpdateError("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", jpeg));
  // Neuer Typ in Großbuchstaben: abgelehnt; schon so gespeichert und unverändert: erlaubt.
  const upper = jpeg.replace("jpeg", "JPEG");
  assert.ok(lostItemImageUpdateError(upper, jpeg));
  assert.equal(lostItemImageUpdateError(upper, upper), null);
  assert.equal(lostItemCreateSchema.safeParse({ description: "Schlüssel", foundDate: "2026-11-24", image: upper }).success, false);
});
