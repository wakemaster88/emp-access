import { test } from "node:test";
import assert from "node:assert/strict";
import { GALLERY_FULL_EVERY_MS, decodeEmbedding, galleryRequest, parseGallery } from "./gallery-rules.js";

/** Merkmal, wie es in der Datenbank liegt (Float32 LE), und beide Formen der Antwort. */
function forms(values: number[]): { bytes: Buffer; array: number[]; base64: string } {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
  // Zahlen-Array wie die Cloud es baut (embeddingBytesToFloats) und durch JSON schickt.
  const array: number[] = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) array.push(bytes.readFloatLE(i));
  return { bytes, array: JSON.parse(JSON.stringify(array)) as number[], base64: bytes.toString("base64") };
}

test("Base64 und Zahlen-Array ergeben dieselben Werte", () => {
  // 512 Werte wie buffalo_l, darunter sehr kleine, negative und nicht exakt darstellbare.
  const values = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.37) / (1 + (i % 7)) + (i % 11 === 0 ? 1e-9 : 0));
  const f = forms(values);
  const fromArray = decodeEmbedding(f.array);
  const fromBase64 = decodeEmbedding(f.base64);
  assert.ok(fromArray && fromBase64);
  assert.equal(fromArray.length, 512);
  assert.deepEqual(fromBase64, fromArray);
  assert.deepEqual(fromBase64, values.map((v) => Math.fround(v)));
});

test("Merkmal: unbrauchbare Formen ergeben null", () => {
  assert.equal(decodeEmbedding(undefined), null);
  assert.equal(decodeEmbedding(null), null);
  assert.equal(decodeEmbedding(""), null);
  assert.equal(decodeEmbedding([]), null);
  assert.equal(decodeEmbedding([0.1, null, 0.2]), null);
  assert.equal(decodeEmbedding([0.1, "0.2"]), null);
  assert.equal(decodeEmbedding({ 0: 0.1 }), null);
  // Base64 von NaN.
  const nan = Buffer.alloc(8);
  nan.writeFloatLE(Number.NaN, 0);
  assert.equal(decodeEmbedding(nan.toString("base64")), null);
  // Nur ganze 4 Bytes zählen, wie in der Cloud.
  const f = forms([0.5, -0.25]);
  assert.deepEqual(decodeEmbedding(Buffer.concat([f.bytes, Buffer.from([1, 2])]).toString("base64")), [0.5, -0.25]);
});

test("Abruf: ohne Version voller Abruf, mit Version nur bis zum stündlichen vollen", () => {
  const now = 10 * GALLERY_FULL_EVERY_MS;
  assert.deepEqual(galleryRequest({ version: null, fullAt: now - 1000, now }), {
    path: "/api/hub/person-embeddings?enc=b64",
    sent: null,
  });
  assert.deepEqual(galleryRequest({ version: "g1-107-215-a-b", fullAt: now - 1000, now }), {
    path: "/api/hub/person-embeddings?enc=b64&v=g1-107-215-a-b",
    sent: "g1-107-215-a-b",
  });
  assert.equal(galleryRequest({ version: "g1-1-1-a-b", fullAt: now - GALLERY_FULL_EVERY_MS, now }).sent, null);
  assert.equal(galleryRequest({ version: "g1-1-1-a-b", fullAt: now - GALLERY_FULL_EVERY_MS + 1, now }).sent, "g1-1-1-a-b");
  // Uhr zurückgestellt oder Zeitpunkt kaputt: lieber voll.
  assert.equal(galleryRequest({ version: "g1-1-1-a-b", fullAt: Number.NaN, now }).sent, null);
  assert.equal(galleryRequest({ version: "g1-1-1-a-b", fullAt: now + 60_000, now }).sent, null);
  // Version mit Sonderzeichen wird kodiert.
  assert.equal(galleryRequest({ version: "a&b", fullAt: now, now }).path, "/api/hub/person-embeddings?enc=b64&v=a%26b");
});

test("Antwort: unverändert nur mit der geschickten Version", () => {
  assert.deepEqual(parseGallery({ unchanged: true, version: "v1" }, "v1"), { kind: "unchanged" });
  assert.equal(parseGallery({ unchanged: true, version: "v2" }, "v1").kind, "invalid");
  assert.equal(parseGallery({ unchanged: true, version: "v1" }, null).kind, "invalid");
  assert.equal(parseGallery({ unchanged: true }, "v1").kind, "invalid");
});

test("Antwort: neue Cloud (Base64, Version) und alte Cloud (Zahlen-Array, ohne Version) ergeben dieselbe Galerie", () => {
  const a = forms([0.1, 0.2, 0.3, 0.4]);
  const b = forms([-0.4, 0.3, -0.2, 0.1]);
  const rows = [
    { id: 1, listedPersonId: 7, name: "Person A", listType: "WHITELIST", model: "buffalo_l" },
    { id: 2, listedPersonId: 8, name: "Person B", listType: "BLACKLIST", model: "buffalo_l" },
  ];
  const fresh = parseGallery(
    { version: "g1-2-2-x-y", embeddings: [{ ...rows[0], embedding: a.base64 }, { ...rows[1], embedding: b.base64 }] },
    null
  );
  const old = parseGallery({ embeddings: [{ ...rows[0], embedding: a.array }, { ...rows[1], embedding: b.array }] }, null);
  assert.equal(fresh.kind, "full");
  assert.equal(old.kind, "full");
  if (fresh.kind !== "full" || old.kind !== "full") return;
  assert.equal(fresh.version, "g1-2-2-x-y");
  assert.equal(old.version, null);
  assert.deepEqual(fresh.entries, old.entries);
  assert.deepEqual(fresh.entries.map((e) => [e.id, e.listedPersonId, e.listType]), [
    [1, 7, "WHITELIST"],
    [2, 8, "BLACKLIST"],
  ]);
});

test("Antwort: Einträge ohne brauchbares Merkmal fallen weg, ohne Liste ist der Bestand leer", () => {
  const a = forms([0.1, 0.2]);
  const r = parseGallery(
    { version: "v", embeddings: [{ id: 1, listedPersonId: 7, name: "A", listType: "WHITELIST", embedding: a.base64 }, { id: 2 }, null] },
    null
  );
  assert.equal(r.kind, "full");
  if (r.kind === "full") {
    assert.equal(r.entries.length, 1);
    assert.equal(r.dropped, 2);
  }
  const empty = parseGallery({ error: "x" }, null);
  assert.deepEqual(empty, { kind: "full", entries: [], version: null, dropped: 0 });
  assert.deepEqual(parseGallery(null, null), { kind: "full", entries: [], version: null, dropped: 0 });
});
