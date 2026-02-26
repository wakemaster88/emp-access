import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const services = await db.service.findMany({
    where: { accountId: accountId! },
    include: {
      areas: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(services);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }

  const { db, accountId } = session;
  const areaIds: number[] = Array.isArray(body.areaIds) ? body.areaIds.map(Number) : [];
  const annyNames: string[] = Array.isArray(body.annyNames) ? body.annyNames : [];

  const service = await db.service.create({
    data: {
      name: body.name.trim(),
      annyNames: annyNames.length > 0 ? JSON.stringify(annyNames) : null,
      accountId: accountId!,
      areas: areaIds.length > 0 ? { connect: areaIds.map((id) => ({ id })) } : undefined,
    },
    include: {
      areas: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
  });
  return NextResponse.json(service, { status: 201 });
}
