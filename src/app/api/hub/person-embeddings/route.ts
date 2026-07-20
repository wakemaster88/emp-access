import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import {
  embeddingBytesToFloats,
  storePersonFaceEmbedding,
} from "@/lib/persons";

/**
 * GET (Hub): Gallery aller aktiven Face-Embeddings fuer lokales Matching.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

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
    embeddings: rows.map((r) => ({
      id: r.id,
      listedPersonId: r.listedPersonId,
      name: r.listedPerson.name,
      listType: r.listedPerson.listType,
      model: r.model,
      embedding: embeddingBytesToFloats(r.embedding),
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
