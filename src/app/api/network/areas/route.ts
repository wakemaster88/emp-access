import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const areas = await db.networkArea.findMany({
    where: { accountId: accountId! },
    include: {
      vlan: { select: { id: true, vlanId: true, name: true } },
      _count: { select: { clients: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(areas);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }

  let vlanId: number | null = null;
  if (body.vlanId) {
    const n = Number(body.vlanId);
    const vlan = await db.networkVlan.findFirst({ where: { id: n, accountId: accountId! } });
    if (!vlan) return NextResponse.json({ error: "VLAN nicht gefunden" }, { status: 400 });
    vlanId = n;
  }

  try {
    const area = await db.networkArea.create({
      data: {
        name: body.name.trim(),
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        description: body.description?.trim() || null,
        vlanId,
        ipFrom: body.ipFrom?.trim() || null,
        ipTo: body.ipTo?.trim() || null,
        accountId: accountId!,
      },
    });
    return NextResponse.json(area, { status: 201 });
  } catch (e: unknown) {
    const msg = String(e);
    if (msg.includes("Unique constraint") || msg.includes("NetworkArea_accountId_name")) {
      return NextResponse.json({ error: "Bereich mit diesem Namen existiert bereits" }, { status: 400 });
    }
    throw e;
  }
}
