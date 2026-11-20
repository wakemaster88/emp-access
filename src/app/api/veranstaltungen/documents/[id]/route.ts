import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteBlobs } from "@/lib/blob-store";
import { parseId, venueSession } from "@/lib/venue-session";
import { logChange } from "@/lib/venue-events";
import { documentResponse } from "@/lib/venue-documents";
import { DOCUMENT_KIND_LABEL, type VenueDocumentKind } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PDF ansehen (Backoffice). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const s = await venueSession();
  if ("error" in s) return s.error;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  return documentResponse({ id, accountId: s.accountId });
}

/** Dokument entfernen (z. B. falsche Datei hochgeladen). */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const doc = await prisma.venueEventDocument.findFirst({
    where: { id, accountId: s.accountId },
    select: { id: true, eventId: true, kind: true, pdfBlob: true },
  });
  if (!doc) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.venueEventDocument.delete({ where: { id: doc.id } });
  await deleteBlobs([doc.pdfBlob]);
  await logChange(doc.eventId, s.actor, `${DOCUMENT_KIND_LABEL[doc.kind as VenueDocumentKind]} entfernt`);
  return NextResponse.json({ ok: true });
}
