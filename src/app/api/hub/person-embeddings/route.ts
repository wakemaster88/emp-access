import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import {
  embeddingBytesToFloats,
  storePersonFaceEmbedding,
} from "@/lib/persons";
import {
  embeddingBytesToBase64,
  galleryUnchanged,
  galleryVersion,
  galleryWantsBase64,
} from "@/lib/face-gallery-rules";

/**
 * GET (Hub): Gallery aller aktiven Face-Embeddings fuer lokales Matching.
 *
 * Jede Antwort traegt `version` (face-gallery-rules.ts). Schickt der Hub
 * `?v=<version>` und hat sich nichts geaendert, kommt nur
 * `{ unchanged: true, version }`. Mit `?enc=b64` stehen die Merkmale als
 * Base64 (Float32 LE, wie im Header X-Face-Embedding) statt als
 * Zahlen-Array in `embedding`; ohne die Parameter (aelterer Hub) bleibt die
 * Antwort wie bisher, nur um `version` erweitert.
 *
 * Die Version wird vor dem Bestand gelesen: Kommt dazwischen ein Merkmal
 * dazu, liefert die Antwort es mit, und der naechste Abruf holt wegen der
 * neueren Version den Bestand noch einmal. Umgekehrt koennte der Hub eine
 * Version zu einem Bestand ohne das neue Merkmal behalten.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const [emb, persons] = await Promise.all([
    db.personFaceEmbedding.aggregate({
      where: { accountId: account.id, listedPerson: { isActive: true } },
      _count: { _all: true },
      _max: { id: true, createdAt: true },
    }),
    db.listedPerson.aggregate({
      where: { accountId: account.id, isActive: true },
      _max: { updatedAt: true },
    }),
  ]);
  const version = galleryVersion({
    count: emb._count._all,
    maxId: emb._max.id,
    maxCreatedAt: emb._max.createdAt,
    maxPersonUpdatedAt: persons._max.updatedAt,
  });
  const params = request.nextUrl.searchParams;
  if (galleryUnchanged(params.get("v"), version)) {
    return NextResponse.json({ unchanged: true, version });
  }
  const base64 = galleryWantsBase64(params.get("enc"));

  const rows = await db.personFaceEmbedding.findMany({
    where: {
      accountId: account.id,
      listedPerson: { isActive: true },
    },
    select: {
      id: true,
      listedPersonId: true,
      embedding: true,
      model: true,
      listedPerson: { select: { name: true, listType: true } },
    },
    orderBy: { id: "asc" },
  });

  return NextResponse.json({
    version,
    embeddings: rows.map((r) => ({
      id: r.id,
      listedPersonId: r.listedPersonId,
      name: r.listedPerson.name,
      listType: r.listedPerson.listType,
      model: r.model,
      embedding: base64 ? embeddingBytesToBase64(r.embedding) : embeddingBytesToFloats(r.embedding),
    })),
  });
}

/**
 * POST (Hub): neues Embedding nach Enrollment speichern.
 * Body: { listedPersonId, embedding: number[], model?, sourceSightingId? }
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { account } = auth;

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.embedding)) {
    return NextResponse.json({ error: "embedding fehlt" }, { status: 400 });
  }
  const listedPersonId = Number(body.listedPersonId);
  if (!Number.isInteger(listedPersonId)) {
    return NextResponse.json({ error: "listedPersonId fehlt" }, { status: 400 });
  }

  try {
    const result = await storePersonFaceEmbedding({
      accountId: account.id,
      listedPersonId,
      embedding: body.embedding.map(Number).filter((n: number) => Number.isFinite(n)),
      model: typeof body.model === "string" ? body.model : undefined,
      sourceSightingId:
        body.sourceSightingId != null ? Number(body.sourceSightingId) : null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fehler" },
      { status: 400 }
    );
  }
}
