import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const monitorId = Number(id);
  if (isNaN(monitorId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const { db, accountId } = session;

  const existing = await db.monitorConfig.findFirst({
    where: { id: monitorId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const monitor = await db.monitorConfig.update({
    where: { id: monitorId },
    data: {
      name: body.name?.trim() ?? existing.name,
      deviceIds: body.deviceIds ?? existing.deviceIds,
      isActive: body.isActive ?? existing.isActive,
    },
  });
  return NextResponse.json(monitor);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const monitorId = Number(id);
  if (isNaN(monitorId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const existing = await db.monitorConfig.findFirst({
    where: { id: monitorId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.monitorConfig.delete({ where: { id: monitorId } });
  return NextResponse.json({ ok: true });
}
