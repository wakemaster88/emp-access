import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveBinary } from "@/lib/blob-store";

/** PDFs beginnen mit "%PDF-"; alles andere lehnen wir ab. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** Dateiname fuer Content-Disposition: nur harmlose Zeichen, endet auf .pdf. */
export function safePdfName(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N} ._-]+/gu, "_").trim().slice(0, 100) || "dokument";
  return `${base}.pdf`;
}

/**
 * PDF-Antwort eines Dokuments. `where` legt fest, wer es sehen darf (Mandant,
 * beim Partner zusaetzlich der eigene Termin).
 */
export async function documentResponse(where: { id: number; accountId: number; event?: { partnerId: number } }, markViewed = false) {
  const doc = await prisma.venueEventDocument.findFirst({
    where,
    select: { id: true, fileName: true, pdf: true, pdfBlob: true },
  });
  if (!doc) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const bytes = await resolveBinary({ blob: doc.pdfBlob, bytes: doc.pdf });
  if (!bytes) return NextResponse.json({ error: "Datei nicht verfügbar" }, { status: 404 });
  if (markViewed) await prisma.venueEventDocument.update({ where: { id: doc.id }, data: { viewedAt: new Date() } }).catch(() => undefined);
  const name = safePdfName(doc.fileName);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
