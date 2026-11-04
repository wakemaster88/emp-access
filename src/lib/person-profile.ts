/**
 * Erkennungsprofil einer Person: in den Unbekannten nach ihr suchen,
 * Profil aus der Sammlung optimieren und bei sicheren Treffern dazulernen.
 */
import { prisma } from "@/lib/prisma";
import {
  embeddingBytesToFloats,
  floatsToEmbeddingBytes,
} from "@/lib/persons";
import { chooseProfile, cosine, shouldAutoLearn, type FaceItem } from "@/lib/face-clusters";

/** Ab hier werden Unbekannte als moegliche Treffer gezeigt. */
const SEARCH_MIN = 0.3;
/** Ab hier sind Treffer in der Suche vorausgewaehlt. */
export const SEARCH_PRESELECT = 0.45;
const SEARCH_LIMIT = 80;
const SCAN_BATCH = 1000;
const PROFILE_MAX = 12;

export interface SimilarUnknown {
  id: number;
  score: number;
  seenAt: string;
  camera: string | null;
}

/**
 * Alle unzugeordneten Sichtungen mit Gesicht gegen die Samples der Person
 * vergleichen (bestes Sample zaehlt), aehnlichste zuerst.
 */
export async function findSimilarUnknown(
  accountId: number,
  listedPersonId: number
): Promise<{ matches: SimilarUnknown[]; scanned: number; pending: number; samples: number }> {
  const person = await prisma.listedPerson.findFirst({
    where: { id: listedPersonId, accountId },
    select: { id: true },
  });
  if (!person) throw new Error("Person nicht gefunden");

  const sampleRows = await prisma.personFaceEmbedding.findMany({
    where: { accountId, listedPersonId },
    select: { embedding: true },
  });
  const samples = sampleRows.map((s) => embeddingBytesToFloats(s.embedding));

  const pending = await prisma.personSighting.count({
    where: { accountId, listedPersonId: null, faceEmbedding: null },
  });
  if (samples.length === 0) return { matches: [], scanned: 0, pending, samples: 0 };

  const top: SimilarUnknown[] = [];
  let scanned = 0;
  let cursor = 0;
  // In Stapeln, damit auch tausende Unbekannte nicht auf einmal im Speicher landen.
  for (;;) {
    const rows = await prisma.personSighting.findMany({
      where: { accountId, listedPersonId: null, faceEmbedding: { not: null }, id: { gt: cursor } },
      select: { id: true, faceEmbedding: true, seenAt: true, camera: { select: { name: true } } },
      orderBy: { id: "asc" },
      take: SCAN_BATCH,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      if (!r.faceEmbedding || r.faceEmbedding.length < 256) continue;
      scanned++;
      const e = embeddingBytesToFloats(r.faceEmbedding);
      let best = -1;
      for (const s of samples) best = Math.max(best, cosine(e, s));
      if (best < SEARCH_MIN) continue;
      top.push({
        id: r.id,
        score: Math.round(best * 1000) / 1000,
        seenAt: r.seenAt.toISOString(),
        camera: r.camera?.name ?? null,
      });
    }
    // Zwischendurch kuerzen, Liste bleibt klein.
    if (top.length > SEARCH_LIMIT * 3) {
      top.sort((a, b) => b.score - a.score);
      top.length = SEARCH_LIMIT;
    }
    if (rows.length < SCAN_BATCH) break;
  }
  top.sort((a, b) => b.score - a.score);
  return { matches: top.slice(0, SEARCH_LIMIT), scanned, pending, samples: samples.length };
}

/**
 * Profil aus bisherigen Samples + allen zugeordneten Sichtungen neu waehlen:
 * Fehlgriffe (passen nicht zum Rest) raus, bis zu 12 verschiedene behalten.
 */
export async function optimizePersonProfile(
  accountId: number,
  listedPersonId: number
): Promise<{ before: number; after: number; removed: number; added: number; candidates: number }> {
  const person = await prisma.listedPerson.findFirst({
    where: { id: listedPersonId, accountId },
    select: { id: true },
  });
  if (!person) throw new Error("Person nicht gefunden");

  const existing = await prisma.personFaceEmbedding.findMany({
    where: { accountId, listedPersonId },
    select: { id: true, embedding: true, sourceSightingId: true },
  });
  const sightings = await prisma.personSighting.findMany({
    where: { accountId, listedPersonId, faceEmbedding: { not: null } },
    select: { id: true, faceEmbedding: true },
    orderBy: { seenAt: "desc" },
    take: 500,
  });

  // Samples mit negativer ID, Sichtungen positiv – so bleiben beide unterscheidbar.
  const sampleSources = new Set(existing.map((e) => e.sourceSightingId).filter(Boolean));
  const items: FaceItem[] = [
    ...existing.map((e) => ({ id: -e.id, embedding: embeddingBytesToFloats(e.embedding) })),
    ...sightings
      .filter((s) => s.faceEmbedding && s.faceEmbedding.length >= 256 && !sampleSources.has(s.id))
      .map((s) => ({ id: s.id, embedding: embeddingBytesToFloats(s.faceEmbedding!) })),
  ];
  if (items.length === 0) {
    return { before: 0, after: 0, removed: 0, added: 0, candidates: 0 };
  }

  const { keep } = chooseProfile(items, PROFILE_MAX);
  const keepSet = new Set(keep);
  const drop = existing.filter((e) => !keepSet.has(-e.id)).map((e) => e.id);
  const add = items.filter((i) => i.id > 0 && keepSet.has(i.id));

  await prisma.$transaction([
    prisma.personFaceEmbedding.deleteMany({ where: { id: { in: drop }, accountId } }),
    ...add.map((a) =>
      prisma.personFaceEmbedding.create({
        data: {
          accountId,
          listedPersonId,
          embedding: new Uint8Array(floatsToEmbeddingBytes(a.embedding)),
          sourceSightingId: a.id,
        },
        select: { id: true },
      })
    ),
  ]);

  return {
    before: existing.length,
    after: existing.length - drop.length + add.length,
    removed: drop.length,
    added: add.length,
    candidates: items.length,
  };
}

/** Nach sicherem Auto-Match ggf. ein neues Sample lernen (best effort). */
export async function maybeAutoLearn(opts: {
  accountId: number;
  listedPersonId: number;
  sightingId: number;
  embedding: Uint8Array | null | undefined;
  matchScore: number | null | undefined;
}): Promise<boolean> {
  if (!opts.embedding || opts.embedding.length < 256 || opts.matchScore == null) return false;
  const e = embeddingBytesToFloats(opts.embedding);
  const rows = await prisma.personFaceEmbedding.findMany({
    where: { accountId: opts.accountId, listedPersonId: opts.listedPersonId },
    select: { embedding: true },
  });
  const samples = rows.map((r) => embeddingBytesToFloats(r.embedding));
  if (!shouldAutoLearn({ embedding: e, samples, matchScore: opts.matchScore })) return false;
  await prisma.personFaceEmbedding.create({
    data: {
      accountId: opts.accountId,
      listedPersonId: opts.listedPersonId,
      embedding: new Uint8Array(opts.embedding),
      model: "buffalo_l",
      sourceSightingId: opts.sightingId,
    },
    select: { id: true },
  });
  return true;
}
