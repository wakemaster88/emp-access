import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { roomInclude, syncRoomEquipment } from "@/lib/keying-queries";
import { keyRoomUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const roomId = Number((await params).id);
  if (isNaN(roomId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = keyRoomUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.keyRoom.findFirst({ where: { id: roomId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  await db.keyRoom.update({
    where: { id: roomId },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.number !== undefined && { number: data.number?.trim() || null }),
      ...(data.building !== undefined && { building: data.building?.trim() || null }),
      ...(data.floor !== undefined && { floor: data.floor?.trim() || null }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    },
    select: { id: true },
  });

  await syncRoomEquipment(db, accountId, roomId, data);

  const room = await db.keyRoom.findUnique({ where: { id: roomId }, include: roomInclude });
  return NextResponse.json(room);
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

  const roomId = Number((await params).id);
  if (isNaN(roomId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.keyRoom.findFirst({ where: { id: roomId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Tueren bleiben erhalten und rutschen auf "ohne Raum" (onDelete: SetNull).
  await db.keyRoom.delete({ where: { id: roomId } });
  return NextResponse.json({ ok: true });
}
