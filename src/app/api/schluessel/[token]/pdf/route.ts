import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPlausibleSignatureToken } from "@/lib/keying";

/**
 * Download des eigenen unterschriebenen Protokolls. Der Token bleibt dafuer
 * auch nach Ablauf der Signaturfrist gueltig – wer unterschrieben hat, soll
 * sein Dokument behalten koennen.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isPlausibleSignatureToken(token)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const signature = await prisma.keySignature.findUnique({
    where: { token },
    select: { pdf: true, handoverId: true },
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
