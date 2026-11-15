import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { ensureRiderProfile, riderAppPath } from "@/lib/rider-app";
import { resetRiderAccess } from "@/lib/rider-auth";
import { prisma } from "@/lib/prisma";

/**
 * POST: Zugang eines Fahrers zurücksetzen (Passwort vergessen, Handy weg).
 * Passwort und Passkeys werden gelöscht, alle Sitzungen enden, und es gibt
 * einen neuen Einladungslink. Statistik und Gutscheine bleiben.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;

  const ticketId = Number((await params).ticketId);
  if (!Number.isInteger(ticketId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }
  const ensured = await ensureRiderProfile(session.accountId, ticketId);
  if (!ensured) return NextResponse.json({ error: "Kein Abo-Ticket gefunden" }, { status: 404 });
  const profile = await prisma.riderProfile.findUnique({ where: { token: ensured.token }, select: { id: true } });
  const token = profile ? await resetRiderAccess(profile.id, session.accountId) : null;
  if (!token) return NextResponse.json({ error: "Zurücksetzen fehlgeschlagen" }, { status: 500 });
  return NextResponse.json({ path: riderAppPath(token) });
}
