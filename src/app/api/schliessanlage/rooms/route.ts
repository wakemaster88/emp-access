import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { roomInclude } from "@/lib/keying-queries";
import { keyRoomCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const rooms = await db.keyRoom.findMany({
    where: { accountId: accountId! },
    include: roomInclude,
    orderBy: [{ building: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(rooms);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = keyRoomCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const room = await session.db.keyRoom.create({
    data: {
      accountId: session.accountId,
      name: data.name.trim(),
      number: data.number?.trim() || null,
      building: data.building?.trim() || null,
      floor: data.floor?.trim() || null,
      notes: data.notes?.trim() || null,
    },
    include: roomInclude,
  });
  return NextResponse.json(room, { status: 201 });
}
