import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/** DELETE (Admin): Token widerrufen. Es gilt sofort nicht mehr. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  if (!session.accountId) return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const r = await session.db.mcpToken.updateMany({
    where: { id, accountId: session.accountId!, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
