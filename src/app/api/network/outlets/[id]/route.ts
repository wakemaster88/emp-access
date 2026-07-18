import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const VALID_TYPES = ["WALL_OUTLET", "PATCH_PANEL"];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const outletId = Number(id);
  if (isNaN(outletId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkOutlet.findFirst({
    where: { id: outletId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Anschluss-Typ" }, { status: 400 });
  }

  if (body.label?.trim() && body.label.trim() !== existing.label) {
    const dup = await db.networkOutlet.findFirst({
      where: { accountId: accountId!, label: body.label.trim(), NOT: { id: outletId } },
    });
    if (dup) {
      return NextResponse.json({ error: "Ein Anschluss mit dieser Beschriftung existiert bereits" }, { status: 400 });
    }
  }

  const outlet = await db.networkOutlet.update({
    where: { id: outletId },
    data: {
      label: body.label?.trim() || existing.label,
      location: body.location !== undefined ? (body.location?.trim() || null) : existing.location,
      type: body.type ?? existing.type,
      notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
    },
  });
  return NextResponse.json(outlet);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const outletId = Number(id);
  if (isNaN(outletId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkOutlet.findFirst({
    where: { id: outletId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.networkOutlet.delete({ where: { id: outletId } });
  return NextResponse.json({ ok: true });
}
