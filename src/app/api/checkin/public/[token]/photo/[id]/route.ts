import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decodeImageDataUrl } from "@/lib/photo-url";

/**
 * Ticket-Foto fuer den Check-in-Monitor. Die Poll-Antwort
 * (/api/checkin/public/[token]) enthaelt statt des Base64-Bildes nur diese
 * URL samt Versions-Parameter `v` (Ticket.updatedAt) - der Browser laedt
 * jedes Foto einmal und nimmt es danach aus dem Cache.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { accountId: true, isActive: true, type: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const ticketId = Number(id);
  if (!Number.isInteger(ticketId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId: monitor.accountId },
    select: { profileImage: true },
  });
  const stored = ticket?.profileImage?.trim() ?? "";
  // Aeltere/importierte Tickets koennen statt einer Data-URL einen Link tragen.
  if (/^https:\/\//i.test(stored)) {
    return NextResponse.redirect(stored, 302);
  }
  const image = stored ? decodeImageDataUrl(stored) : null;
  if (!image) {
    return NextResponse.json({ error: "Kein Foto" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      // `private`: Personenfotos gehoeren nicht in einen geteilten CDN-Cache.
      // Die URL traegt die Ticket-Version, deshalb darf der Browser sie
      // dauerhaft behalten.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
