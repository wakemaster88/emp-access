import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/** Authentifizierter Download des archivierten Protokoll-PDF. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const signatureId = Number((await params).id);
  if (isNaN(signatureId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const signature = await db.keySignature.findFirst({
    where: { id: signatureId, accountId: accountId! },
    select: { pdf: true, handoverId: true, signedAt: true },
  });

  if (!signature) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!signature.pdf) {
    return NextResponse.json({ error: "Noch nicht unterschrieben" }, { status: 409 });
  }

  return new NextResponse(new Uint8Array(signature.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="schluesselprotokoll-${signature.handoverId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
