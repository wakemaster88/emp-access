import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const svcId = Number(id);
  if (isNaN(svcId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const service = await db.service.findFirst({
    where: { id: svcId, accountId: accountId! },
    include: {
      areas: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
  });
  if (!service) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(service);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const svcId = Number(id);
  if (isNaN(svcId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const { db, accountId } = session;

  const existing = await db.service.findFirst({
    where: { id: svcId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const areaIds: number[] | undefined = Array.isArray(body.areaIds) ? body.areaIds.map(Number) : undefined;
  const annyNames: string[] | undefined = Array.isArray(body.annyNames) ? body.annyNames : undefined;

  const service = await db.service.update({
    where: { id: svcId },
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
  return NextResponse.json(service);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const svcId = Number(id);
  if (isNaN(svcId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.service.findFirst({
    where: { id: svcId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.service.delete({ where: { id: svcId } });
  return NextResponse.json({ ok: true });
}
