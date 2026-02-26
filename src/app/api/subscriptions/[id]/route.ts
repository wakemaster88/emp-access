import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const subId = Number(id);
  if (isNaN(subId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const sub = await db.subscription.findFirst({
    where: { id: subId, accountId: accountId! },
    include: {
      areas: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
  });
  if (!sub) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(sub);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const subId = Number(id);
  if (isNaN(subId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const { db, accountId } = session;

  const existing = await db.subscription.findFirst({
    where: { id: subId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const areaIds: number[] | undefined = Array.isArray(body.areaIds) ? body.areaIds.map(Number) : undefined;
  const annyNames: string[] | undefined = Array.isArray(body.annyNames) ? body.annyNames : undefined;

  const sub = await db.subscription.update({
    where: { id: subId },
    data: {
      name: body.name?.trim() ?? existing.name,
      annyNames: annyNames !== undefined
        ? (annyNames.length > 0 ? JSON.stringify(annyNames) : null)
        : existing.annyNames,
      areas: areaIds !== undefined
        ? { set: areaIds.map((id) => ({ id })) }
        : undefined,
    },
    include: {
      areas: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
  });
  return NextResponse.json(sub);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const subId = Number(id);
  if (isNaN(subId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.subscription.findFirst({
    where: { id: subId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.subscription.delete({ where: { id: subId } });
  return NextResponse.json({ ok: true });
}
