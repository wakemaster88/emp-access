import { test } from "node:test";
import assert from "node:assert/strict";
import { bestShot, faceQuality, fuseEmbeddings, rankGallery, cosine, type FaceShot } from "./face-rules.js";

const shot = (embedding: number[], o: Partial<FaceShot> = {}): FaceShot => ({
  embedding,
  detScore: 0.8,
  size: 100,
  frontal: 1,
  sharp: 1,
  upscaled: false,
  ...o,
});

test("Gross, frontal und scharf schlaegt klein, gedreht oder unscharf", () => {
  const good = faceQuality(shot([1, 0]));
  assert.ok(good > faceQuality(shot([1, 0], { size: 30 })));
  assert.ok(good > faceQuality(shot([1, 0], { frontal: 0.1 })));
  assert.ok(good > faceQuality(shot([1, 0], { sharp: 0.1 })));
  assert.ok(good > faceQuality(shot([1, 0], { upscaled: true })));
  // Aelterer Face-Dienst ohne frontal/sharp: trotzdem eine Zahl.
  assert.ok(faceQuality({ embedding: [1], detScore: 0.7, upscaled: false }) > 0);
});

test("Bestes Bild der Serie", () => {
  assert.equal(bestShot([]), -1);
  assert.equal(bestShot([shot([1, 0], { sharp: 0.2 }), shot([1, 0]), shot([1, 0], { size: 20 })]), 1);
});

test("Mitteln nur mit Bildern derselben Person", () => {
  const a = shot([1, 0.1, 0]);
  const b = shot([0.9, 0.2, 0], { sharp: 0.6 });
  const other = shot([0, 0, 1], { sharp: 0.5 });
  const fused = fuseEmbeddings([a, b, other])!;
  assert.equal(fused.used, 2);
  assert.ok(cosine(fused.embedding, [0, 0, 1]) < 0.01);
  assert.ok(Math.abs(Math.hypot(...fused.embedding) - 1) < 1e-9);
  assert.equal(fuseEmbeddings([]), null);
});

test("Gemittelte Merkmale liegen naeher an der Person als ein verrauschtes Einzelbild", () => {
  const person = [1, 0, 0, 0];
  const n1 = shot([1, 0.6, 0, 0]);
  const n2 = shot([1, -0.5, 0.1, 0]);
  const fused = fuseEmbeddings([n1, n2])!;
  assert.ok(cosine(fused.embedding, person) > cosine(n1.embedding, person));
});

test("Abgleich je Person mit Abstand zum Zweitbesten", () => {
  const gallery = [
    { listedPersonId: 1, name: "A", listType: "WHITELIST", embedding: [1, 0, 0] },
    { listedPersonId: 1, name: "A", listType: "WHITELIST", embedding: [0.9, 0.1, 0] },
    { listedPersonId: 2, name: "B", listType: "WHITELIST", embedding: [0, 1, 0] },
  ];
  const clear = rankGallery([1, 0.05, 0], gallery, 0.45, 0.05);
  assert.equal(clear.match?.name, "A");
  assert.equal(clear.second?.name, "B");
  assert.equal(clear.ambiguous, false);

  // Zwischen A und B: beide ueber der Schwelle, aber fast gleichauf.
  const tie = rankGallery([1, 1.1, 0], gallery, 0.45, 0.05);
  assert.equal(tie.match, null);
  assert.equal(tie.ambiguous, true);
  assert.ok(tie.nearest);

  // Mehrere Merkmale derselben Person sind kein Zweitbester.
  const one = rankGallery([1, 0, 0], gallery.slice(0, 2), 0.45, 0.05);
  assert.equal(one.match?.name, "A");
  assert.equal(one.second, null);

  assert.equal(rankGallery([1, 0, 0], [], 0.45, 0.05).nearest, null);
});
