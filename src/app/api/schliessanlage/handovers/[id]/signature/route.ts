import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionWithDb } from "@/lib/api-auth";
import { buildSignatureSnapshots } from "@/lib/key-signature";
import { createSignatureToken, SIGNATURE_DEFAULT_DAYS } from "@/lib/keying";
import { keySignatureCreateSchema } from "@/lib/validators";

/**
 * Erzeugt einen Signatur-Link (QR) fuer die oeffentliche Seite. Belehrungstext
 * und Schluesselliste werden dabei eingefroren.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const handoverId = Number((await params).id);
  if (isNaN(handoverId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = keySignatureCreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const snapshots = await buildSignatureSnapshots(db, accountId, handoverId, data.policyTemplateId);
  if (!snapshots.ok) return NextResponse.json({ error: snapshots.message }, { status: 400 });

  const days = data.expiresInDays ?? SIGNATURE_DEFAULT_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const signature = await db.keySignature.create({
    data: {
      accountId,
      handoverId,
      kind: data.kind ?? "HANDOVER",
      token: createSignatureToken(),
      expiresAt,
      policyTemplateId: snapshots.policyTemplateId,
      policySnapshot: snapshots.policySnapshot as unknown as Prisma.InputJsonObject,
      keySnapshot: snapshots.keySnapshot as unknown as Prisma.InputJsonObject,
    },
    select: {
      id: true,
      kind: true,
      token: true,
      expiresAt: true,
      createdAt: true,
      signedAt: true,
      signedName: true,
    },
  });

  const origin = request.nextUrl.origin;
  return NextResponse.json(
    { ...signature, url: `${origin}/schluessel/${signature.token}` },
    { status: 201 },
  );
}
