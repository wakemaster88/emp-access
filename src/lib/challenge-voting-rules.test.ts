import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodePhotoDataUrl, photoContentType, pollPercents, seededOrder, votesText } from "./challenge-voting-rules";
import { challengeSchema, normalizeChallenge, pollOptions } from "./gamification-input";
import { challengeConditionText, challengeCountsRides, challengeSettlesAtEnd } from "./gamification";

function dataUrl(bytes: number[], type = "jpeg"): string {
  const buf = Buffer.alloc(200, 0);
  Buffer.from(bytes).copy(buf);
  return `data:image/${type};base64,${buf.toString("base64")}`;
}

describe("decodePhotoDataUrl", () => {
  it("nimmt JPEG und PNG an den ersten Bytes", () => {
    assert.equal(decodePhotoDataUrl(dataUrl([0xff, 0xd8, 0xff]))?.ext, "jpg");
    assert.equal(decodePhotoDataUrl(dataUrl([0x89, 0x50, 0x4e, 0x47], "png"))?.contentType, "image/png");
  });
  it("lehnt falsche Dateien und andere Typen ab", () => {
    assert.equal(decodePhotoDataUrl(dataUrl([0x47, 0x49, 0x46])), null);
    assert.equal(decodePhotoDataUrl("data:image/gif;base64,AAAA"), null);
    assert.equal(decodePhotoDataUrl("data:image/jpeg;base64,/9j/"), null);
  });
  it("erkennt den Inhaltstyp an den Bytes", () => {
    assert.equal(photoContentType(new Uint8Array([0x89, 0x50])), "image/png");
    assert.equal(photoContentType(new Uint8Array([0xff, 0xd8])), "image/jpeg");
  });
});

describe("pollPercents", () => {
  it("ergibt zusammen 100", () => {
    assert.deepEqual(pollPercents([1, 1, 1]), [34, 33, 33]);
    assert.equal(pollPercents([2, 1]).reduce((a, b) => a + b, 0), 100);
  });
  it("ohne Stimmen alles 0", () => {
    assert.deepEqual(pollPercents([0, 0]), [0, 0]);
  });
});

describe("seededOrder", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id }));
  it("bleibt für dieselbe Person gleich", () => {
    assert.deepEqual(seededOrder(items, 5), seededOrder(items, 5));
  });
  it("behält alle Einträge", () => {
    assert.deepEqual(seededOrder(items, 9).map((i) => i.id).sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("ist für verschiedene Personen meist anders", () => {
    const orders = new Set([1, 2, 3, 4, 5].map((seed) => seededOrder(items, seed).map((i) => i.id).join(",")));
    assert.ok(orders.size > 1);
  });
});

describe("Challenge-Arten", () => {
  it("Foto und Abstimmung zählen keine Starts", () => {
    assert.equal(challengeCountsRides("PHOTO"), false);
    assert.equal(challengeCountsRides("POLL"), false);
    assert.equal(challengeCountsRides("TASK"), true);
    assert.equal(challengeSettlesAtEnd("PHOTO"), true);
    assert.equal(challengeSettlesAtEnd("POLL"), false);
  });
  it("beschreibt die Bedingung", () => {
    const base = { metric: "VISIT_DAYS" as const, threshold: null };
    assert.equal(challengeConditionText({ ...base, kind: "PHOTO", topCount: 1 }), "Foto hochladen, das beliebteste gewinnt");
    assert.equal(challengeConditionText({ ...base, kind: "PHOTO", topCount: 3 }), "Foto hochladen, die 3 beliebtesten gewinnen");
    assert.equal(challengeConditionText({ ...base, kind: "POLL", topCount: null }), "Abstimmung, eine Stimme je Person");
  });
  it("votesText", () => {
    assert.equal(votesText(1), "1 Stimme");
    assert.equal(votesText(0), "0 Stimmen");
  });
});

describe("Eingabe Abstimmung", () => {
  const poll = {
    name: "Welche Challenge als Nächstes?",
    description: null,
    kind: "POLL" as const,
    metric: "STARTS" as const,
    threshold: null,
    topCount: null,
    startDate: "2026-12-01",
    endDate: "2026-12-07",
    voucherLabel: "Freigetränk",
    voucherValidDays: 30,
    active: true,
  };
  it("braucht mindestens zwei verschiedene Antworten", () => {
    assert.equal(challengeSchema.safeParse({ ...poll, options: ["A"] }).success, false);
    assert.equal(challengeSchema.safeParse({ ...poll, options: ["A", " a ", ""] }).success, false);
    assert.equal(challengeSchema.safeParse({ ...poll, options: ["A", "B"] }).success, true);
  });
  it("höchstens sechs", () => {
    assert.equal(challengeSchema.safeParse({ ...poll, options: ["1", "2", "3", "4", "5", "6", "7"] }).success, false);
  });
  it("räumt Antworten auf", () => {
    assert.deepEqual(pollOptions(["  Sprung ", "sprung", "", "Rail  Jam"]), ["Sprung", "Rail Jam"]);
  });
  it("Abstimmung vergibt keinen Gutschein und zählt nichts", () => {
    const n = normalizeChallenge({ ...poll, options: ["A", "B"] });
    assert.equal(n.voucherLabel, null);
    assert.equal(n.metric, "VISIT_DAYS");
    assert.equal(n.topCount, null);
  });
  it("Foto-Challenge braucht die Anzahl der Gewinner", () => {
    assert.equal(challengeSchema.safeParse({ ...poll, kind: "PHOTO" }).success, false);
    const ok = challengeSchema.safeParse({ ...poll, kind: "PHOTO", topCount: 1 });
    assert.equal(ok.success, true);
    if (ok.success) assert.equal(normalizeChallenge(ok.data).topCount, 1);
  });
});
