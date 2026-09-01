import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { doorInclude } from "@/lib/keying-queries";
import { keyDoorCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const doors = await db.keyDoor.findMany({
    where: { accountId: accountId! },
    include: doorInclude,
    orderBy: [{ name: "asc" }],
  });
  return NextResponse.json(doors);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = keyDoorCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  if (data.roomId != null) {
    const room = await db.keyRoom.findFirst({ where: { id: data.roomId, accountId } });
    if (!room) return NextResponse.json({ error: "Raum nicht gefunden" }, { status: 400 });
  }

  const door = await db.keyDoor.create({
    data: {
      accountId,
      roomId: data.roomId ?? null,
      name: data.name.trim(),
      doorNumber: data.doorNumber?.trim() || null,
      notes: data.notes?.trim() || null,
    },
    include: doorInclude,
  });
  return NextResponse.json(door, { status: 201 });
}
