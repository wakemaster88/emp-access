/**
 * Erkennungsprofil einer Person: in den Unbekannten nach ihr suchen,
 * Profil aus der Sammlung optimieren und bei sicheren Treffern dazulernen.
 */
import { prisma } from "@/lib/prisma";
import {
  embeddingBytesToFloats,
  floatsToEmbeddingBytes,
  profileSampleRanks,
} from "@/lib/persons";
import {
  autoLearnDecision,
  autoLearnLine,
  autoLearnPrecheck,
  chooseProfile,
  cosine,
  MANUAL_SAMPLE_LOG_TAG,
  pickDiverseSamples,
  sampleRank,
  type AutoLearnQuality,
  type FaceItem,
} from "@/lib/face-clusters";

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
 * Wie bei der Zuordnung von Hand kommen hochgerechnete Gesichter nur dazu,
 * wenn weder das Profil noch die uebrigen Sichtungen etwas Besseres haben
 * (sampleRank, profileSampleRanks). Fehlgriffe werden mit allen Sichtungen
 * bestimmt; die Auswahl beschraenkt nur, was neu dazukommt.
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
    select: { id: true, faceEmbedding: true, faceSize: true, faceUpscaled: true },
    orderBy: { seenAt: "desc" },
    take: 500,
  });

  // Samples mit negativer ID, Sichtungen positiv – so bleiben beide unterscheidbar.
  const sampleSources = new Set(existing.map((e) => e.sourceSightingId).filter(Boolean));
  const fresh = sightings.filter((s) => s.faceEmbedding && s.faceEmbedding.length >= 256 && !sampleSources.has(s.id));
  const profileBetter = existing.length > 0 && (await profileSampleRanks(accountId, listedPersonId)).some((r) => r < 2);
  const better = profileBetter || fresh.some((s) => sampleRank(s) < 2);
  const allowed = new Set((better ? fresh.filter((s) => sampleRank(s) < 2) : fresh).map((s) => s.id));
  if (allowed.size < fresh.length) {
    console.log(
      `${MANUAL_SAMPLE_LOG_TAG} account=${accountId}: Profil optimieren ohne ${fresh.length - allowed.size} hochgerechnete Gesichter, ` +
        (allowed.size > 0 ? "bessere vorhanden" : "Profil hat bessere")
    );
  }
  const items: FaceItem[] = [
    ...existing.map((e) => ({ id: -e.id, embedding: embeddingBytesToFloats(e.embedding) })),
    ...fresh.map((s) => ({ id: s.id, embedding: embeddingBytesToFloats(s.faceEmbedding!) })),
  ];
  if (items.length === 0) {
    return { before: 0, after: 0, removed: 0, added: 0, candidates: 0 };
  }

  // Fehlgriffe mit allen Sichtungen bestimmen, auswaehlen nur aus Samples und erlaubten Sichtungen.
  const { outliers } = chooseProfile(items, PROFILE_MAX);
  const outlierSet = new Set(outliers);
  const keep = pickDiverseSamples(
    items.filter((i) => !outlierSet.has(i.id) && (i.id < 0 || allowed.has(i.id))),
    PROFILE_MAX
  );
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

/**
 * Nach einem Treffer des Hubs ggf. ein neues Sample lernen (best effort):
 * nur aus einem klaren Treffer und nie bei gesperrten Personen
 * (face-clusters.ts autoLearnDecision). Jede Gelegenheit steht mit Grund im
 * Log (AUTO_LEARN_LOG_TAG), ohne Namen.
 */
export async function maybeAutoLearn(opts: {
  accountId: number;
  listedPersonId: number;
  /** Liste der Person (WHITELIST | BLACKLIST). */
  listType: string | null;
  cameraId: number | null;
  sightingId: number;
  embedding: Uint8Array | null | undefined;
  matchScore: number | null | undefined;
  /** Guete des Gesichts an der Sichtung; null = ohne Angaben (aelterer Hub). */
  quality: AutoLearnQuality | null | undefined;
}): Promise<boolean> {
  const e = opts.embedding && opts.embedding.length >= 256 ? embeddingBytesToFloats(opts.embedding) : [];
  const input = { embedding: e, matchScore: opts.matchScore, listType: opts.listType, quality: opts.quality };
  const ctx = { accountId: opts.accountId, cameraId: opts.cameraId, sightingId: opts.sightingId };
  // Erst ohne Datenbank pruefen: Die meisten Treffer scheiden hier aus.
  let decision = autoLearnPrecheck(input);
  if (!decision.skip) {
    const rows = await prisma.personFaceEmbedding.findMany({
      where: { accountId: opts.accountId, listedPersonId: opts.listedPersonId },
      select: { embedding: true },
    });
    decision = autoLearnDecision({ ...input, samples: rows.map((r) => embeddingBytesToFloats(r.embedding)) });
  }
  if (decision.skip || !opts.embedding) {
    console.log(autoLearnLine(ctx, decision));
    return false;
  }
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
  console.log(autoLearnLine(ctx, decision));
  return true;
}
