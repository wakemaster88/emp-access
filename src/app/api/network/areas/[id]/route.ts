import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const areaId = Number(id);
  if (!Number.isInteger(areaId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await db.networkArea.findFirst({
    where: { id: areaId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();

  let vlanId = existing.vlanId;
  if (body.vlanId !== undefined) {
    if (body.vlanId === null || body.vlanId === 0 || body.vlanId === "none") {
      vlanId = null;
    } else {
      const n = Number(body.vlanId);
      const vlan = await db.networkVlan.findFirst({ where: { id: n, accountId: accountId! } });
      if (!vlan) return NextResponse.json({ error: "VLAN nicht gefunden" }, { status: 400 });
      vlanId = n;
    }
  }

  try {
    const area = await db.networkArea.update({
      where: { id: areaId },
      data: {
        name: body.name?.trim() || existing.name,
        sortOrder:
          body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
            ? Number(body.sortOrder)
            : existing.sortOrder,
        description:
          body.description !== undefined ? (body.description?.trim() || null) : existing.description,
        vlanId,
        ipFrom: body.ipFrom !== undefined ? (body.ipFrom?.trim() || null) : existing.ipFrom,
        ipTo: body.ipTo !== undefined ? (body.ipTo?.trim() || null) : existing.ipTo,
      },
    });
    return NextResponse.json(area);
  } catch (e: unknown) {
    const msg = String(e);
    if (msg.includes("Unique constraint") || msg.includes("NetworkArea_accountId_name")) {
      return NextResponse.json({ error: "Bereich mit diesem Namen existiert bereits" }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const areaId = Number(id);
  if (!Number.isInteger(areaId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await db.networkArea.findFirst({
    where: { id: areaId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.networkArea.delete({ where: { id: areaId } });
  return NextResponse.json({ ok: true });
}
