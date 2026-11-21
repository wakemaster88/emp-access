import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { inviteCustomer } from "@/lib/rider-invite";

/**
 * Kundenkonto einzeln zur Kunden-App einladen (Abos › Kundenkonten).
 * Schickt die Einladungsmail an die Adresse des Kontos, nur für Admins.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { accountId } = session;
  if (!accountId) return NextResponse.json({ error: "Nur innerhalb eines Kontos möglich." }, { status: 403 });

  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }
  const result = await inviteCustomer(accountId, customerId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, sentAt: result.sentAt });
}
