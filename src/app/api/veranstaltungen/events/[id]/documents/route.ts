import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storeEventDocument } from "@/lib/blob-store";
import { parseId, venueSession } from "@/lib/venue-session";
import { documentMessage, loadEvent, logChange, notifyPartner, serializeEventForAdmin } from "@/lib/venue-events";
import { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS, MAX_DOCUMENT_BYTES, type VenueDocumentKind } from "@/lib/venue-event-rules";
import { looksLikePdf } from "@/lib/venue-documents";
import { parseEuroToCents } from "@/lib/verein-portal-rules";

export const dynamic = "force-dynamic";

/**
 * POST (multipart): `file` (PDF aus DATEV), `kind`, optional `reference`
 * (Rechnungsnummer), `amount` (Euro brutto), `notify` ("0" = keine Mail).
 * Eine Auftragsbestätigung bestätigt den Termin, eine Schlussrechnung
 * markiert ihn als abgerechnet.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const event = await loadEvent(s.accountId, id);
  if (!event) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "") as VenueDocumentKind;
  if (!DOCUMENT_KINDS.includes(kind)) return NextResponse.json({ error: "Bitte die Art des Dokuments wählen" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Bitte eine PDF-Datei wählen" }, { status: 400 });
  if (file.size > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: "Die Datei ist größer als 4 MB" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return NextResponse.json({ error: "Das ist keine PDF-Datei" }, { status: 400 });

  const reference = String(form?.get("reference") ?? "").trim().slice(0, 60) || null;
  const amountRaw = String(form?.get("amount") ?? "").trim();
  const amountCents = amountRaw ? parseEuroToCents(amountRaw) : null;
  if (amountRaw && amountCents == null) return NextResponse.json({ error: "Ungültiger Betrag" }, { status: 400 });

  const stored = await storeEventDocument(s.accountId, bytes);
  await prisma.venueEventDocument.create({
    data: {
      accountId: s.accountId,
      eventId: id,
      kind,
      fileName: (file.name || "dokument.pdf").slice(0, 200),
      size: bytes.length,
      ...stored,
      reference,
      amountCents: amountCents || null,
      uploadedBy: s.actor.name,
    },
  });
  await logChange(id, s.actor, `${DOCUMENT_KIND_LABEL[kind]} hochgeladen${reference ? ` (${reference})` : ""}`);

  const now = new Date();
  if (kind === "ORDER_CONFIRMATION" && event.status === "RESERVED") {
    await prisma.venueEvent.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: now } });
  }
  if (kind === "FINAL_INVOICE" && !event.billedAt) {
    await prisma.venueEvent.update({ where: { id }, data: { billedAt: now } });
  }

  const fresh = (await loadEvent(s.accountId, id))!;
  if (form?.get("notify") !== "0" && fresh.partnerId && fresh.status !== "CANCELED") {
    const partner = await prisma.eventPartner.findFirst({ where: { id: fresh.partnerId, accountId: s.accountId } });
    if (partner) {
      await notifyPartner(partner, fresh, `${DOCUMENT_KIND_LABEL[kind]}: ${fresh.title}`, documentMessage(kind), request.nextUrl.origin);
    }
  }
  return NextResponse.json({ event: serializeEventForAdmin(fresh) }, { status: 201 });
}
