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
