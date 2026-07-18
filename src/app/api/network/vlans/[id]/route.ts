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
  const vlanDbId = Number(id);
  if (isNaN(vlanDbId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkVlan.findFirst({
    where: { id: vlanDbId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();

  let vlanId = existing.vlanId;
  if (body.vlanId !== undefined) {
    const n = Number(body.vlanId);
    if (!Number.isInteger(n) || n < 1 || n > 4094) {
      return NextResponse.json({ error: "VLAN-ID muss zwischen 1 und 4094 liegen" }, { status: 400 });
    }
    if (n !== existing.vlanId) {
      const dup = await db.networkVlan.findFirst({ where: { accountId: accountId!, vlanId: n } });
      if (dup) return NextResponse.json({ error: `VLAN ${n} existiert bereits` }, { status: 400 });
    }
    vlanId = n;
  }

  const vlan = await db.networkVlan.update({
    where: { id: vlanDbId },
    data: {
      vlanId,
      name: body.name?.trim() || existing.name,
      subnet: body.subnet !== undefined ? (body.subnet?.trim() || null) : existing.subnet,
      gateway: body.gateway !== undefined ? (body.gateway?.trim() || null) : existing.gateway,
      description: body.description !== undefined ? (body.description?.trim() || null) : existing.description,
    },
  });
  return NextResponse.json(vlan);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const vlanDbId = Number(id);
  if (isNaN(vlanDbId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkVlan.findFirst({
    where: { id: vlanDbId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.networkVlan.delete({ where: { id: vlanDbId } });
  return NextResponse.json({ ok: true });
}
