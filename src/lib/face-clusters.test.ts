import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_LEARN_LOG_TAG,
  autoLearnDecision,
  autoLearnLine,
  autoLearnPrecheck,
  chooseProfile,
  clusterFaces,
  shouldAutoLearn,
  cosine,
  pickDiverseSamples,
  pickManualSamples,
  rankKnownPersons,
  sampleRank,
  type AutoLearnInput,
  type RankedFace,
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

test("Profil: Fehlgriff fliegt raus, Rest bleibt", () => {
  const r = rng(6);
  const anna = randomVec(r);
  const items = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: i + 1, embedding: around(anna, r) })),
    { id: 99, embedding: randomVec(r) },
  ];
  const { keep, outliers } = chooseProfile(items, 4);
  assert.deepEqual(outliers, [99]);
  assert.equal(keep.length, 4);
  assert.ok(!keep.includes(99));
});

/** Direkt gefundenes, klares Gesicht: 80 px, Abstand 0,15 zur zweitbesten Person. */
const GOOD = { faceSize: 80, faceUpscaled: false, faceMargin: 0.15 };

test("Auto-Lernen nur bei klarem Treffer und neuem Blickwinkel", () => {
  const r = rng(7);
  const face = randomVec(r);
  const s1 = around(face, r);
  const e = around(face, r);
  const base = { embedding: e, samples: [s1], listType: "WHITELIST", quality: GOOD };
  assert.equal(shouldAutoLearn({ ...base, matchScore: 0.65 }), true);
  assert.equal(shouldAutoLearn({ ...base, matchScore: 0.6 }), true);
  assert.equal(shouldAutoLearn({ ...base, matchScore: 0.55 }), false);
  assert.equal(shouldAutoLearn({ ...base, matchScore: 0.46 }), false);
  // Gleicht einem vorhandenen Sample: bringt nichts Neues.
  assert.equal(shouldAutoLearn({ ...base, embedding: s1, matchScore: 0.9 }), false);
  // Profil voll.
  assert.equal(shouldAutoLearn({ ...base, samples: Array(20).fill(around(face, r)), matchScore: 0.65 }), false);
  assert.equal(shouldAutoLearn({ ...base, samples: Array(19).fill(around(face, r)), matchScore: 0.65 }), true);
});

test("Auto-Lernen: Ähnlichkeit genau an der Grenze 0,8 gilt als bekannt", () => {
  // Kosinus genau 0,8: [1, 0, …] gegen [4, 3, 0, …] (4/5).
  const e = [1, ...Array<number>(63).fill(0)];
  const at = [4, 3, ...Array<number>(62).fill(0)];
  assert.equal(cosine(e, at), 0.8);
  const base = { embedding: e, matchScore: 0.7, listType: "WHITELIST", quality: GOOD };
  assert.equal(autoLearnDecision({ ...base, samples: [at] }).skip, "bekannt");
  // Knapp darunter: neuer Blickwinkel, wird gelernt.
  const below = [4, 3.01, ...Array<number>(62).fill(0)];
  assert.ok(cosine(e, below) < 0.8);
  assert.equal(autoLearnDecision({ ...base, samples: [below] }).skip, null);
});

test("Auto-Lernen: Gründe in fester Reihenfolge", () => {
  const r = rng(8);
  const e = randomVec(r);
  const ok: AutoLearnInput = { embedding: e, matchScore: 0.65, listType: "WHITELIST", quality: GOOD };
  const skip = (o: Partial<AutoLearnInput>) => autoLearnPrecheck({ ...ok, ...o }).skip;
  assert.equal(skip({}), null);
  // Hochgerechnetes Gesicht, auch mit hohem Score und grossem Abstand.
  assert.equal(skip({ quality: { ...GOOD, faceUpscaled: true }, matchScore: 0.9 }), "hochgerechnet");
  // Kopf-Ausschnitt: hochgerechnet, ohne Groesse im Kamerabild.
  assert.equal(skip({ quality: { faceSize: null, faceUpscaled: true, faceMargin: 0.3 } }), "hochgerechnet");
  assert.equal(skip({ quality: { ...GOOD, faceSize: 63.9 } }), "zu_klein");
  assert.equal(skip({ quality: { ...GOOD, faceSize: 64 } }), null);
  assert.equal(skip({ matchScore: 0.599 }), "score");
  assert.equal(skip({ matchScore: null }), "score");
  assert.equal(skip({ quality: { ...GOOD, faceMargin: 0.099 } }), "abstand");
  assert.equal(skip({ quality: { ...GOOD, faceMargin: 0.1 } }), null);
  // Gesperrte Person: nie von selbst, auch beim besten Gesicht.
  assert.equal(skip({ listType: "BLACKLIST", matchScore: 0.95, quality: { faceSize: 200, faceUpscaled: false, faceMargin: 0.5 } }), "sperrliste");
  // Von selbst lernt nur die Whitelist: fehlende oder unbekannte Liste nicht.
  assert.equal(skip({ listType: null }), "sperrliste");
  assert.equal(skip({ listType: "GAST" }), "sperrliste");
  // Ohne Guete-Angaben (aelterer Hub) nicht lernen.
  assert.equal(skip({ quality: null }), "guete_fehlt");
  assert.equal(skip({ quality: undefined }), "guete_fehlt");
  assert.equal(skip({ quality: { faceSize: null, faceUpscaled: null, faceMargin: null } }), "guete_fehlt");
  // Ohne zweite Person in der Galerie fehlt der Abstand.
  assert.equal(skip({ quality: { ...GOOD, faceMargin: null } }), "guete_fehlt");
  assert.equal(skip({ quality: { ...GOOD, faceSize: null } }), "guete_fehlt");
  // Nur „hochgerechnet“ fehlt (z. B. ein Wert, den parseFaceQuality verwirft): nicht lernen.
  assert.equal(skip({ quality: { faceSize: 80, faceUpscaled: null, faceMargin: 0.2 } }), "guete_fehlt");
  assert.equal(
    autoLearnPrecheck({ ...ok, quality: { faceSize: 80, faceUpscaled: null, faceMargin: 0.2 } }).detail,
    "Güte-Angaben fehlen (hochgerechnet)"
  );
  assert.equal(skip({ embedding: [] }), "merkmal");
});

test("Auto-Lernen: Log-Zeile mit festem Kürzel und Grund, ohne Namen", () => {
  const ctx = { accountId: 1, cameraId: 3, sightingId: 456 };
  const e = randomVec(rng(9));
  const skipped = autoLearnDecision({ embedding: e, samples: [], matchScore: 0.552, listType: "WHITELIST", quality: GOOD });
  assert.equal(
    autoLearnLine(ctx, skipped),
    `${AUTO_LEARN_LOG_TAG} account=1 Kamera 3 Sichtung 456: nicht gelernt, grund=score (Score 0.552 unter 0.60)`
  );
  const learned = autoLearnDecision({ embedding: e, samples: [], matchScore: 0.65, listType: "WHITELIST", quality: GOOD });
  assert.equal(learned.skip, null);
  assert.equal(
    autoLearnLine(ctx, learned),
    `${AUTO_LEARN_LOG_TAG} account=1 Kamera 3 Sichtung 456: gelernt (Score 0.650, 80 px, Abstand 0.150)`
  );
  const old = autoLearnDecision({ embedding: e, samples: [], matchScore: 0.65, listType: "WHITELIST", quality: null });
  assert.equal(autoLearnLine({ ...ctx, cameraId: null }, old), `${AUTO_LEARN_LOG_TAG} account=1 Kamera ? Sichtung 456: nicht gelernt, grund=guete_fehlt (Güte-Angaben fehlen)`);
  const noSecond = autoLearnDecision({ embedding: e, samples: [], matchScore: 0.65, listType: "WHITELIST", quality: { ...GOOD, faceMargin: null } });
  assert.equal(noSecond.detail, "Güte-Angaben fehlen (Abstand)");
  const blocked = autoLearnDecision({ embedding: e, samples: [], matchScore: 0.65, listType: "BLACKLIST", quality: GOOD });
  assert.match(autoLearnLine(ctx, blocked), /grund=sperrliste/);
});

test("Rang eines Gesichts als Sample: gut, ohne Angaben, hochgerechnet", () => {
  assert.equal(sampleRank({ faceSize: 80, faceUpscaled: false }), 0);
  assert.equal(sampleRank({ faceSize: 64, faceUpscaled: false }), 0);
  // Direkt, aber kleiner als 64 px (kleinere Kamerabilder).
  assert.equal(sampleRank({ faceSize: 52, faceUpscaled: false }), 1);
  assert.equal(sampleRank({ faceSize: null, faceUpscaled: false }), 1);
  // Sichtung eines aelteren Hubs oder Sample ohne Quelle.
  assert.equal(sampleRank({ faceSize: null, faceUpscaled: null }), 1);
  // Groesse bekannt, aber offen, ob hochgerechnet: nicht als gut einstufen.
  assert.equal(sampleRank({ faceSize: 80, faceUpscaled: null }), 1);
  assert.equal(sampleRank(null), 1);
  assert.equal(sampleRank(undefined), 1);
  assert.equal(sampleRank({ faceSize: 200, faceUpscaled: true }), 2);
  assert.equal(sampleRank({ faceSize: null, faceUpscaled: true }), 2);
});

test("Zuordnung von Hand: gute Gesichter zuerst, hochgerechnete nur ohne Besseres", () => {
  const r = rng(10);
  const face = randomVec(r);
  const item = (id: number, rank: 0 | 1 | 2): RankedFace => ({ id, embedding: around(face, r), rank });
  const good = [item(1, 0), item(2, 0)];
  const unknown = [item(11, 1), item(12, 1), item(13, 1)];
  const upscaled = [item(21, 2), item(22, 2), item(23, 2)];

  // Gute zuerst, Rest mit Sichtungen ohne Angaben auffuellen, keine hochgerechneten.
  const picked = pickManualSamples([...upscaled, ...unknown, ...good], 4);
  assert.equal(picked.length, 4);
  assert.ok(picked.includes(1) && picked.includes(2));
  assert.ok(!picked.some((id) => id > 20));
  assert.deepEqual(pickManualSamples([...upscaled, ...good], 5).sort(), [1, 2]);
  // Mehr gute als Platz: nur gute.
  const manyGood = Array.from({ length: 8 }, (_, i) => item(30 + i, 0));
  const onlyGood = pickManualSamples([...manyGood, ...unknown], 5);
  assert.equal(onlyGood.length, 5);
  assert.ok(onlyGood.every((id) => id >= 30));

  // Nur hochgerechnete: genommen, wenn das Profil nichts Besseres hat.
  assert.equal(pickManualSamples(upscaled, 5).length, 3);
  assert.equal(pickManualSamples(upscaled, 5, [2, 2]).length, 3);
  assert.equal(pickManualSamples(upscaled, 2, []).length, 2);
  // Profil hat bessere (gute oder ohne Angaben): keine hochgerechneten dazu.
  assert.deepEqual(pickManualSamples(upscaled, 5, [1]), []);
  assert.deepEqual(pickManualSamples(upscaled, 5, [2, 0]), []);
  // Eine einzelne Sichtung (Zuordnung aus dem Verlauf).
  assert.deepEqual(pickManualSamples([item(40, 2)], 1, []), [40]);
  assert.deepEqual(pickManualSamples([item(41, 2)], 1, [1, 1]), []);
  assert.deepEqual(pickManualSamples([item(42, 1)], 1, [0]), [42]);
  // Kein Platz mehr im Profil: nichts.
  assert.deepEqual(pickManualSamples([...good, ...unknown], 0), []);
  assert.deepEqual(pickManualSamples([], 5), []);
});
