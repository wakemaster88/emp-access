import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { floatsToEmbeddingBytes } from "@/lib/persons";

/**
 * POST (Hub, Token): Embedding einer bestehenden Sichtung nachtragen
 * (Task FACE_ANALYZE). Body: { embedding: number[] | null } –
 * null heisst „kein Gesicht gefunden“ und wird als leere Bytes gemerkt,
 * damit die Sichtung nicht immer wieder analysiert wird.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { account } = auth;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const raw: unknown = body?.embedding;
  let bytes: Uint8Array<ArrayBuffer>;
  if (raw == null) {
    bytes = new Uint8Array(0);
  } else if (Array.isArray(raw)) {
    const values = raw.map(Number);
    if (values.length < 64 || values.length > 2048 || !values.every(Number.isFinite)) {
      return NextResponse.json({ error: "Embedding ungültig" }, { status: 400 });
    }
    bytes = new Uint8Array(floatsToEmbeddingBytes(values));
  } else {
    return NextResponse.json({ error: "embedding fehlt" }, { status: 400 });
  }

  const res = await prisma.personSighting.updateMany({
    where: { id, accountId: account.id },
    data: { faceEmbedding: bytes },
  });
  if (res.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true, dims: bytes.length / 4 });
}
