import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { newPublicToken } from "@/lib/tokens";

/**
 * POST (Session, Verwaltung): „Link erneuern“. Der Monitor bekommt einen
 * neuen Link-Token; der alte Link gilt ab sofort nicht mehr. Geräte und
 * Einstellungen des Monitors bleiben, wie sie sind.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;

  const { id } = await params;
  const monitorId = Number(id);
  if (isNaN(monitorId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  // Ohne zugeordnetes Konto (z. B. Super-Admin ohne Konto) wie die anderen Routen.
  if (accountId == null) return NextResponse.json({ error: "Kein Konto zugeordnet" }, { status: 403 });
  const existing = await db.monitorConfig.findFirst({
    where: { id: monitorId, accountId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const monitor = await db.monitorConfig.update({
    where: { id: monitorId },
    data: { token: newPublicToken() },
  });
  console.info("[monitore] Link erneuert", {
    accountId,
    monitorId,
    adminId: session.session.user.id ? String(session.session.user.id) : null,
  });
  return NextResponse.json(monitor);
}
