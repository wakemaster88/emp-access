import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { ensureRiderProfile, riderAppPath } from "@/lib/rider-app";

/**
 * POST: persönlichen App-Link für ein Abo-Ticket erzeugen (oder den
 * vorhandenen liefern). Das Personal zeigt ihn als QR-Code oder gibt ihn weiter.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;

  const ticketId = Number((await params).ticketId);
  if (!Number.isInteger(ticketId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }
  const profile = await ensureRiderProfile(session.accountId, ticketId);
  if (!profile) {
    return NextResponse.json({ error: "Kein Abo-Ticket gefunden" }, { status: 404 });
  }
  return NextResponse.json({ path: riderAppPath(profile.token) });
}
