import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const vlans = await db.networkVlan.findMany({
    where: { accountId: accountId! },
    include: {
      _count: { select: { ports: true, taggedPorts: true, clients: true } },
    },
    orderBy: { vlanId: "asc" },
  });
  return NextResponse.json(vlans);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }
  const vlanId = Number(body.vlanId);
  if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
    return NextResponse.json({ error: "VLAN-ID muss zwischen 1 und 4094 liegen" }, { status: 400 });
  }

  const existing = await db.networkVlan.findFirst({
    where: { accountId: accountId!, vlanId },
  });
  if (existing) {
    return NextResponse.json({ error: `VLAN ${vlanId} existiert bereits` }, { status: 400 });
  }

  const vlan = await db.networkVlan.create({
    data: {
      vlanId,
      name: body.name.trim(),
      subnet: body.subnet?.trim() || null,
      gateway: body.gateway?.trim() || null,
      description: body.description?.trim() || null,
      accountId: accountId!,
    },
  });
  return NextResponse.json(vlan, { status: 201 });
}
