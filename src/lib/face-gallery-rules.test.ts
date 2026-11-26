import { test } from "node:test";
import assert from "node:assert/strict";
import {
  embeddingBytesToBase64,
  galleryUnchanged,
  galleryVersion,
  galleryWantsBase64,
  type GalleryStats,
} from "./face-gallery-rules";

const base: GalleryStats = {
  count: 107,
  maxId: 215,
  maxCreatedAt: new Date("2026-11-22T15:49:00.000Z"),
  maxPersonUpdatedAt: new Date("2026-11-20T08:00:00.000Z"),
};

test("Version: gleicher Bestand ergibt dieselbe Version", () => {
  assert.equal(galleryVersion(base), galleryVersion({ ...base, maxCreatedAt: new Date(base.maxCreatedAt!.getTime()) }));
  assert.match(galleryVersion(base), /^g1-107-215-[0-9a-z]+-[0-9a-z]+$/);
});

test("Version ändert sich bei jeder Änderung an Personen oder Merkmalen", () => {
  const v = galleryVersion(base);
  const later = (d: Date | null, ms = 1000) => new Date((d?.getTime() ?? 0) + ms);
  const changed: Array<[string, GalleryStats]> = [
    // Merkmal dazu (anlegen, zuordnen, lernen): neue höchste id, neuer createdAt.
    ["Merkmal dazu", { ...base, count: 108, maxId: 216, maxCreatedAt: later(base.maxCreatedAt) }],
    // Merkmal gelöscht (Profil optimieren) oder Person deaktiviert/gelöscht: weniger Merkmale.
    ["Merkmal weg", { ...base, count: 106 }],
    // Profil optimiert: eines weg, eines dazu – gleiche Anzahl, neue id.
    ["eines weg, eines dazu", { ...base, maxId: 216, maxCreatedAt: later(base.maxCreatedAt) }],
    // Person gesperrt, umbenannt oder reaktiviert: jüngstes updatedAt der aktiven Personen.
    ["Person geändert", { ...base, maxPersonUpdatedAt: later(base.maxPersonUpdatedAt) }],
    // Die zuletzt geänderte Person wird deaktiviert (ohne Merkmale): jüngstes updatedAt fällt zurück.
    ["zuletzt geänderte Person deaktiviert", { ...base, maxPersonUpdatedAt: later(base.maxPersonUpdatedAt, -60_000) }],
    ["alles weg", { count: 0, maxId: null, maxCreatedAt: null, maxPersonUpdatedAt: null }],
  ];
  const seen = new Set([v]);
  for (const [label, stats] of changed) {
    const next = galleryVersion(stats);
    assert.notEqual(next, v, label);
    seen.add(next);
  }
  assert.equal(seen.size, changed.length + 1);
});

test("Version ohne Bestand und mit kaputten Werten bleibt ein fester Text", () => {
  assert.equal(galleryVersion({ count: 0, maxId: null, maxCreatedAt: null, maxPersonUpdatedAt: null }), "g1-0-0-0-0");
  assert.equal(
    galleryVersion({ count: 0, maxId: Number.NaN, maxCreatedAt: new Date("kaputt"), maxPersonUpdatedAt: null }),
    "g1-0-0-0-0"
  );
});

test("unverändert nur bei gleicher, mitgeschickter Version", () => {
  const v = galleryVersion(base);
  assert.equal(galleryUnchanged(v, v), true);
  assert.equal(galleryUnchanged(null, v), false);
  assert.equal(galleryUnchanged("", v), false);
  assert.equal(galleryUnchanged("g1-106-215-x-y", v), false);
});

test("Base64 nur auf Wunsch", () => {
  assert.equal(galleryWantsBase64("b64"), true);
  assert.equal(galleryWantsBase64(null), false);
  assert.equal(galleryWantsBase64("json"), false);
});

test("Base64 hat dieselben Bytes wie das Merkmal (Float32 LE)", () => {
  const values = [0.125, -0.5, 1e-7, 0.33333334];
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  const b64 = embeddingBytesToBase64(new Uint8Array(buf));
  assert.equal(b64, buf.toString("base64"));
  const back = Buffer.from(b64, "base64");
  assert.deepEqual([0, 1, 2, 3].map((i) => back.readFloatLE(i * 4)), values.map((v) => Math.fround(v)));
  // Ausschnitt eines größeren Puffers: nur die eigenen Bytes.
  const big = Buffer.concat([Buffer.alloc(8, 0xff), buf]);
  assert.equal(embeddingBytesToBase64(new Uint8Array(big.buffer, big.byteOffset + 8, buf.length)), b64);
});
