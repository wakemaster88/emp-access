import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lockWithPathInclude } from "@/lib/keying-queries";
import { keyLockUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const lockId = Number((await params).id);
  if (isNaN(lockId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = keyLockUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.keyLock.findFirst({ where: { id: lockId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  if (data.doorId !== undefined) {
    const door = await db.keyDoor.findFirst({ where: { id: data.doorId, accountId } });
    if (!door) return NextResponse.json({ error: "Tür nicht gefunden" }, { status: 400 });
  }

  const lock = await db.keyLock.update({
    where: { id: lockId },
    data: {
      ...(data.doorId !== undefined && { doorId: data.doorId }),
      ...(data.lockNumber !== undefined && { lockNumber: data.lockNumber?.trim() || null }),
      ...(data.lockType !== undefined && { lockType: data.lockType }),
      ...(data.system !== undefined && { system: data.system?.trim() || null }),
      ...(data.manufacturer !== undefined && { manufacturer: data.manufacturer?.trim() || null }),
      ...(data.installedAt !== undefined && {
        installedAt: data.installedAt ? new Date(data.installedAt) : null,
      }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    },
    include: lockWithPathInclude,
  });
  return NextResponse.json(lock);
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

  const lockId = Number((await params).id);
  if (isNaN(lockId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.keyLock.findFirst({ where: { id: lockId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Schluessel bleiben bestehen, nur ihre Zuordnung faellt weg (Cascade).
  await db.keyLock.delete({ where: { id: lockId } });
  return NextResponse.json({ ok: true });
}
