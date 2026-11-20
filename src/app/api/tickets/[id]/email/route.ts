import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { normalizeEmail } from "@/lib/day-guest";
import { linkAboCustomerSafe } from "@/lib/customers";

/**
 * E-Mail-Adresse eines Abos nachtragen oder ändern (Abos › „Abos ohne E-Mail“).
 * Ändert nur die Adresse; PUT /api/tickets/[id] würde ohne Laufzeit im Body
 * Start und Ende leeren. Entfernen geht nicht (siehe lib/abo-email).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (!accountId) return NextResponse.json({ error: "Nur innerhalb eines Kontos möglich." }, { status: 403 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: "Bitte eine gültige E-Mail-Adresse eingeben." }, { status: 400 });

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: { id: true, subscriptionId: true, email: true },
  });
  if (!ticket) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (ticket.subscriptionId == null) {
    return NextResponse.json({ error: "Hier lassen sich nur Adressen von Abos eintragen." }, { status: 400 });
  }
  if (ticket.email?.trim().toLowerCase() === email) return NextResponse.json({ id: ticket.id, email });

  const updated = await db.ticket.update({
    where: { id: ticket.id },
    data: { email, version: { increment: 1 } },
    select: { id: true, email: true },
  });
  await linkAboCustomerSafe(accountId, updated.id);
  return NextResponse.json(updated);
}
