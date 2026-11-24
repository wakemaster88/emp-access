import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPlausibleSignatureToken } from "@/lib/keying";
import { resolveBinary } from "@/lib/blob-store";

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
    select: { pdf: true, pdfBlob: true, handoverId: true, signedAt: true },
  });

  if (!signature) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!signature.signedAt) {
    return NextResponse.json({ error: "Noch nicht unterschrieben" }, { status: 409 });
  }
  // Das PDF liegt im Blob-Speicher (`pdfBlob`) oder als Bytes in `pdf`.
  const bytes = await resolveBinary({ blob: signature.pdfBlob, bytes: signature.pdf });
  if (!bytes) {
    return NextResponse.json({ error: "Protokoll gerade nicht verfügbar" }, { status: 503 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="schluesselprotokoll-${signature.handoverId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
