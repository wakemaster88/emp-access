import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const subs = await db.subscription.findMany({
    where: { accountId: accountId! },
    include: {
      areas: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(subs);
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

  const defaultValidityType = ["DATE_RANGE", "TIME_SLOT", "DURATION"].includes(body.defaultValidityType)
    ? body.defaultValidityType
    : null;

  const sub = await db.subscription.create({
    data: {
      name: body.name.trim(),
      annyNames: annyNames.length > 0 ? JSON.stringify(annyNames) : null,
      accountId: accountId!,
      areas: areaIds.length > 0 ? { connect: areaIds.map((id) => ({ id })) } : undefined,
      defaultValidityType,
      defaultStartDate: body.defaultStartDate ? new Date(body.defaultStartDate) : null,
      defaultEndDate: body.defaultEndDate ? new Date(body.defaultEndDate) : null,
      defaultSlotStart: body.defaultSlotStart ?? null,
      defaultSlotEnd: body.defaultSlotEnd ?? null,
      defaultValidityDurationMinutes: body.defaultValidityDurationMinutes != null ? Number(body.defaultValidityDurationMinutes) : null,
      requiresPhoto: !!body.requiresPhoto,
      requiresRfid: !!body.requiresRfid,
    },
    include: {
      areas: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
  });
  return NextResponse.json(sub, { status: 201 });
}
