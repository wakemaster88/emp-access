import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { doorInclude } from "@/lib/keying-queries";
import { keyDoorUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const doorId = Number((await params).id);
  if (isNaN(doorId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = keyDoorUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.keyDoor.findFirst({ where: { id: doorId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  if (data.roomId != null) {
    const room = await db.keyRoom.findFirst({ where: { id: data.roomId, accountId } });
    if (!room) return NextResponse.json({ error: "Raum nicht gefunden" }, { status: 400 });
  }

  const door = await db.keyDoor.update({
    where: { id: doorId },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.roomId !== undefined && { roomId: data.roomId ?? null }),
      ...(data.doorNumber !== undefined && { doorNumber: data.doorNumber?.trim() || null }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    },
    include: doorInclude,
  });
  return NextResponse.json(door);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const doorId = Number((await params).id);
  if (isNaN(doorId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.keyDoor.findFirst({ where: { id: doorId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Schloesser der Tuer haengen per Cascade daran und verschwinden mit.
  await db.keyDoor.delete({ where: { id: doorId } });
  return NextResponse.json({ ok: true });
}
