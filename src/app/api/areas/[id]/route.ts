import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const areaId = Number(id);
  if (isNaN(areaId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const { db, accountId } = session;

  const existing = await db.accessArea.findFirst({
    where: { id: areaId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const area = await db.accessArea.update({
    where: { id: areaId },
    data: {
      name: body.name?.trim() ?? existing.name,
      parentId: body.parentId !== undefined ? (body.parentId ? Number(body.parentId) : null) : existing.parentId,
      allowReentry: body.allowReentry ?? existing.allowReentry,
      personLimit: body.personLimit !== undefined ? (body.personLimit ? Number(body.personLimit) : null) : existing.personLimit,
    },
  });
  return NextResponse.json(area);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const areaId = Number(id);
  if (isNaN(areaId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const existing = await db.accessArea.findFirst({
    where: { id: areaId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.accessArea.delete({ where: { id: areaId } });
  return NextResponse.json({ ok: true });
}
