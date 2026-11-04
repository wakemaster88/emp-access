import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clusterFaces,
  cosine,
  pickDiverseSamples,
  rankKnownPersons,
} from "./face-clusters";

/** Deterministischer Pseudo-Zufall, damit die Tests stabil sind. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
}

function randomVec(r: () => number, dims = 512): number[] {
  return Array.from({ length: dims }, () => r());
}

/** Variation um eine „Identitaet“: Basis + Rauschen (Cosine ~0,6–0,8). */
function around(base: number[], r: () => number, noise = 0.6): number[] {
  return base.map((x) => x + r() * noise);
}

test("trennt zwei Personen und haelt Varianten derselben Person zusammen", () => {
  const r = rng(1);
  const anna = randomVec(r);
  const ben = randomVec(r);
  const items = [
    { id: 1, embedding: around(anna, r) },
    { id: 2, embedding: around(ben, r) },
    { id: 3, embedding: around(anna, r) },
    { id: 4, embedding: around(ben, r) },
    { id: 5, embedding: around(anna, r) },
  ];
  const clusters = clusterFaces(items);
  assert.equal(clusters.length, 2);
  assert.deepEqual([...clusters[0].ids].sort(), [1, 3, 5]);
  assert.deepEqual([...clusters[1].ids].sort(), [2, 4]);
  assert.ok(clusters[0].cohesion > 0.5);
});

test("Einzelgesicht ohne Partner bleibt eigene Gruppe, leere Embeddings fallen raus", () => {
  const r = rng(2);
  const clusters = clusterFaces([
    { id: 1, embedding: randomVec(r) },
    { id: 2, embedding: randomVec(r) },
    { id: 3, embedding: [] },
  ]);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.flatMap((c) => c.ids).sort(), [1, 2]);
});

test("schlaegt die passende bekannte Person vor, fremde nicht", () => {
  const r = rng(3);
  const anna = randomVec(r);
  const other = randomVec(r);
  const [cluster] = clusterFaces([
    { id: 1, embedding: around(anna, r) },
    { id: 2, embedding: around(anna, r) },
  ]);
  const ranked = rankKnownPersons(cluster.centroid, [
    { listedPersonId: 7, embedding: other },
    { listedPersonId: 9, embedding: around(anna, r) },
    { listedPersonId: 9, embedding: around(anna, r) },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].listedPersonId, 9);
  assert.ok(ranked[0].score > 0.5);
});

test("Samples: hoechstens max, ohne Duplikate", () => {
  const r = rng(4);
  const base = randomVec(r);
  const items = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, embedding: around(base, r) }));
  const picked = pickDiverseSamples(items, 4);
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked).size, 4);
  assert.deepEqual(pickDiverseSamples(items.slice(0, 2), 4).sort(), [1, 2]);
});

test("cosine ist symmetrisch und 1 fuer gleiche Vektoren", () => {
  assert.equal(Math.round(cosine([1, 2, 3], [1, 2, 3]) * 1000) / 1000, 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([], [1]), 0);
});

test("600 Gesichter in vertretbarer Zeit", () => {
  const r = rng(5);
  const ids = Array.from({ length: 30 }, () => randomVec(r));
  const items = Array.from({ length: 600 }, (_, i) => ({ id: i + 1, embedding: around(ids[i % 30], r) }));
  const t = Date.now();
  const clusters = clusterFaces(items);
  assert.ok(Date.now() - t < 3000);
  assert.equal(clusters.length, 30);
});
