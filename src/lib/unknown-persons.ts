/**
 * Unbekannte Personen: Sichtungen ohne Zuordnung gruppieren, bekannte
 * Personen vorschlagen und ganze Gruppen per Klick zuordnen bzw. als neue
 * Person anlegen. Die Gesichts-Samples entstehen dabei automatisch.
 */
import { prisma } from "@/lib/prisma";
import {
  embeddingBytesToFloats,
  storePersonFaceEmbedding,
  type PersonListType,
} from "@/lib/persons";
import {
  clusterFaces,
  pickDiverseSamples,
  rankKnownPersons,
  type FaceItem,
} from "@/lib/face-clusters";

/** So viele unbekannte Sichtungen werden hoechstens gruppiert (neueste zuerst). */
const MAX_UNKNOWN = 600;
/** Hoechstens so viele Samples pro Zuordnung (Gallery klein halten). */
const MAX_SAMPLES_PER_ASSIGN = 5;
/** Obergrenze Samples pro Person; aeltere bleiben, neue kommen nicht mehr dazu. */
const MAX_SAMPLES_PER_PERSON = 30;
/** Pro Analyse-Task so viele Sichtungen. */
const ANALYZE_BATCH = 100;
/** Haengengebliebene Analyse-Tasks (Hub offline) blockieren nur so lange. */
const ANALYZE_STALE_MS = 15 * 60_000;

function activeAnalyzeWhere(accountId: number) {
  return {
    accountId,
    type: "FACE_ANALYZE",
    status: { in: ["PENDING", "RUNNING"] },
    createdAt: { gte: new Date(Date.now() - ANALYZE_STALE_MS) },
  };
}

export interface UnknownGroup {
  /** Stabiler Schluessel: kleinste Sichtungs-ID der Gruppe. */
  key: string;
  sightingIds: number[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  cameras: string[];
  cohesion: number;
  suggestions: { listedPersonId: number; name: string; listType: string; score: number }[];
}

export interface UnknownOverview {
  groups: UnknownGroup[];
  /** Mit Bild, aber noch nicht analysiert. */
  pending: number;
  /** Analysiert, kein Gesicht erkennbar. */
  noFace: number;
  /** Ohne Bild (nur Ereignis). */
  noSnapshot: number;
  total: number;
  analyzeQueued: boolean;
}

export async function getUnknownOverview(accountId: number): Promise<UnknownOverview> {
  const rows = await prisma.personSighting.findMany({
    where: { accountId, listedPersonId: null },
    select: {
      id: true,
      seenAt: true,
      faceEmbedding: true,
      snapshotBlob: true,
      camera: { select: { name: true } },
    },
    orderBy: { seenAt: "desc" },
    take: MAX_UNKNOWN,
  });

  // Alte Sichtungen haben das Bild noch inline (`snapshot`) statt im Blob.
  const blobless = rows.filter((r) => !r.snapshotBlob && r.faceEmbedding == null).map((r) => r.id);
  const inline = new Set<number>();
  if (blobless.length) {
    const withBytes = await prisma.personSighting.findMany({
      where: { id: { in: blobless }, snapshot: { not: null } },
      select: { id: true },
    });
    for (const r of withBytes) inline.add(r.id);
  }

  const faces: FaceItem[] = [];
  let pending = 0;
  let noFace = 0;
  let noSnapshot = 0;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    if (r.faceEmbedding == null) {
      if (r.snapshotBlob || inline.has(r.id)) pending++;
      else noSnapshot++;
    } else if (r.faceEmbedding.length === 0) {
      noFace++;
    } else {
      faces.push({ id: r.id, embedding: embeddingBytesToFloats(r.faceEmbedding) });
    }
  }

  const clusters = clusterFaces(faces);

  const known = await prisma.personFaceEmbedding.findMany({
    where: { accountId, listedPerson: { isActive: true } },
    select: {
      listedPersonId: true,
      embedding: true,
      listedPerson: { select: { name: true, listType: true } },
    },
  });
  const knownFaces = known.map((k) => ({
    listedPersonId: k.listedPersonId,
    embedding: embeddingBytesToFloats(k.embedding),
  }));
  const personInfo = new Map(
    known.map((k) => [k.listedPersonId, k.listedPerson] as const)
  );

  const groups: UnknownGroup[] = clusters.map((c) => {
    const members = c.ids.map((id) => byId.get(id)!);
    const times = members.map((m) => m.seenAt.getTime());
    const cameras = [...new Set(members.map((m) => m.camera?.name).filter(Boolean))] as string[];
    const suggestions = rankKnownPersons(c.centroid, knownFaces)
      .slice(0, 3)
      .map((s) => ({
        listedPersonId: s.listedPersonId,
        name: personInfo.get(s.listedPersonId)?.name ?? "?",
        listType: personInfo.get(s.listedPersonId)?.listType ?? "WHITELIST",
        score: Math.round(s.score * 1000) / 1000,
      }));
    return {
      key: String(Math.min(...c.ids)),
      sightingIds: c.ids,
      count: c.ids.length,
      firstSeen: new Date(Math.min(...times)).toISOString(),
      lastSeen: new Date(Math.max(...times)).toISOString(),
      cameras,
      cohesion: Math.round(c.cohesion * 1000) / 1000,
      suggestions,
    };
  });

  // Haeufige und juengst gesehene Gruppen nach oben.
  groups.sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));

  const analyzeQueued =
    (await prisma.hubTask.count({ where: activeAnalyzeWhere(accountId) })) > 0;

  return { groups, pending, noFace, noSnapshot, total: rows.length, analyzeQueued };
}

/**
 * Sichtungen einer bestehenden oder neuen Person zuordnen. Vorhandene
 * Embeddings werden direkt als Samples gespeichert (moeglichst verschiedene),
 * fuer Bilder ohne Embedding uebernimmt der Hub per FACE_ENROLL.
 */
export async function assignSightings(opts: {
  accountId: number;
  sightingIds: number[];
  listedPersonId?: number | null;
  newPerson?: { name: string; listType: PersonListType } | null;
}): Promise<{
  listedPersonId: number;
  name: string;
  created: boolean;
  assigned: number;
  samples: number;
  enrollTasks: number;
}> {
  const ids = [...new Set(opts.sightingIds)].filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) throw new Error("Keine Sichtungen gewählt");

  const sightings = await prisma.personSighting.findMany({
    where: { id: { in: ids }, accountId: opts.accountId },
    select: { id: true, faceEmbedding: true, snapshotBlob: true },
  });
  if (sightings.length === 0) throw new Error("Sichtungen nicht gefunden");

  let person: { id: number; name: string; listType: string };
  let created = false;
  if (opts.newPerson) {
    const name = opts.newPerson.name.trim();
    if (!name) throw new Error("Name fehlt");
    person = await prisma.listedPerson.create({
      data: {
        accountId: opts.accountId,
        name,
        listType: opts.newPerson.listType,
        trackHistory: true,
      },
      select: { id: true, name: true, listType: true },
    });
    created = true;
  } else if (opts.listedPersonId) {
    const found = await prisma.listedPerson.findFirst({
      where: { id: opts.listedPersonId, accountId: opts.accountId },
      select: { id: true, name: true, listType: true },
    });
    if (!found) throw new Error("Person nicht gefunden");
    person = found;
  } else {
    throw new Error("Person wählen oder Namen eingeben");
  }

  const res = await prisma.personSighting.updateMany({
    where: { id: { in: sightings.map((s) => s.id) }, accountId: opts.accountId },
    data: {
      listedPersonId: person.id,
      listType: person.listType,
      matched: true,
      matchMethod: "MANUAL",
    },
  });

  const existing = await prisma.personFaceEmbedding.count({
    where: { listedPersonId: person.id },
  });
  const room = Math.max(0, Math.min(MAX_SAMPLES_PER_ASSIGN, MAX_SAMPLES_PER_PERSON - existing));

  const withFace: FaceItem[] = sightings
    .filter((s) => s.faceEmbedding && s.faceEmbedding.length >= 256)
    .map((s) => ({ id: s.id, embedding: embeddingBytesToFloats(s.faceEmbedding!) }));
  const chosen = new Set(pickDiverseSamples(withFace, room));
  let samples = 0;
  for (const f of withFace) {
    if (!chosen.has(f.id)) continue;
    await storePersonFaceEmbedding({
      accountId: opts.accountId,
      listedPersonId: person.id,
      embedding: f.embedding,
      sourceSightingId: f.id,
    });
    samples++;
  }

  // Noch nicht analysierte Bilder: Hub rechnet das Embedding (nur wenn Platz).
  let enrollTasks = 0;
  const left = room - samples;
  if (left > 0) {
    const unanalyzed = sightings.filter((s) => s.faceEmbedding == null && s.snapshotBlob);
    for (const s of unanalyzed.slice(0, Math.min(left, 3))) {
      await prisma.hubTask.create({
        data: {
          accountId: opts.accountId,
          type: "FACE_ENROLL",
          payload: { sightingId: s.id, listedPersonId: person.id },
        },
        select: { id: true },
      });
      enrollTasks++;
    }
  }

  return {
    listedPersonId: person.id,
    name: person.name,
    created,
    assigned: res.count,
    samples,
    enrollTasks,
  };
}

/** Unzugeordnete Sichtungen mit Bild, aber ohne Embedding, vom Hub analysieren lassen. */
export async function queueFaceAnalysis(accountId: number): Promise<{ queued: number; taskId: number | null }> {
  const running = await prisma.hubTask.findFirst({
    where: activeAnalyzeWhere(accountId),
    select: { id: true },
  });
  if (running) return { queued: 0, taskId: running.id };

  const rows = await prisma.personSighting.findMany({
    where: {
      accountId,
      listedPersonId: null,
      faceEmbedding: null,
      OR: [{ snapshotBlob: { not: null } }, { snapshot: { not: null } }],
    },
    select: { id: true },
    orderBy: { seenAt: "desc" },
    take: ANALYZE_BATCH,
  });
  if (rows.length === 0) return { queued: 0, taskId: null };

  const task = await prisma.hubTask.create({
    data: {
      accountId,
      type: "FACE_ANALYZE",
      payload: { sightingIds: rows.map((r) => r.id) },
    },
    select: { id: true },
  });
  return { queued: rows.length, taskId: task.id };
}
