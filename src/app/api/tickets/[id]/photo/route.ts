import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { ticketPhotoResponse } from "@/lib/ticket-photo";

/**
 * Ticket-Foto fuer angemeldete Ansichten (Dashboard, Ticket- und
 * Mitarbeiterliste, Leitstand). Listen mit `?fotos=url` liefern statt des
 * Base64-Bildes diese URL samt `v` (Ticket.updatedAt); der Browser laedt
 * jedes Foto einmal und nimmt es danach aus dem Cache.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const { db, accountId, isSuperAdmin } = session;
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, ...(isSuperAdmin ? {} : { accountId: accountId! }) },
    select: { profileImage: true },
  });
  return ticketPhotoResponse(ticket?.profileImage, request.nextUrl.searchParams.has("v"));
}
