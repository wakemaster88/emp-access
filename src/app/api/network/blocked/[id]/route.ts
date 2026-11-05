import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

async function load(params: Promise<{ id: string }>) {
  const session = await getSessionWithDb();
  if ("error" in session) return { error: session.error };
  const { db, accountId } = session;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  }
  const row = await db.blockedNetworkDevice.findFirst({ where: { id, accountId: accountId! } });
  if (!row) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  return { db, row };
}

/** Name/Grund ändern oder „in Insight eingetragen“ setzen/zurücknehmen. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await load(params);
  if ("error" in r) return r.error;
  const body = await request.json().catch(() => ({}));
  const data: { name?: string; reason?: string | null; enforcedAt?: Date | null } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
    data.name = name;
  }
  if (body.reason !== undefined) {
    data.reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
  }
  if (typeof body.enforced === "boolean") data.enforcedAt = body.enforced ? new Date() : null;
  const row = await r.db.blockedNetworkDevice.update({ where: { id: r.row.id }, data });
  return NextResponse.json(row);
}

/** Freigeben: Eintrag von der Sperrliste nehmen. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await load(params);
  if ("error" in r) return r.error;
  await r.db.blockedNetworkDevice.delete({ where: { id: r.row.id } });
  return NextResponse.json({ ok: true });
}
