import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const services = await db.service.findMany({
    where: { accountId: accountId! },
    include: {
      serviceAreas: {
        include: { area: { select: { id: true, name: true } } },
      },
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
  const areasPayload: { areaId: number; defaultValidityType?: string; defaultStartDate?: string; defaultEndDate?: string; defaultSlotStart?: string; defaultSlotEnd?: string; defaultValidityDurationMinutes?: number }[] = Array.isArray(body.areas) ? body.areas : (Array.isArray(body.areaIds) ? body.areaIds.map((id: number) => ({ areaId: Number(id) })) : []);
  const annyNames: string[] = Array.isArray(body.annyNames) ? body.annyNames : [];

  const defaultValidityType = ["DATE_RANGE", "TIME_SLOT", "DURATION"].includes(body.defaultValidityType)
    ? body.defaultValidityType
    : null;

  const service = await db.service.create({
    data: {
      name: body.name.trim(),
      annyNames: annyNames.length > 0 ? JSON.stringify(annyNames) : null,
      accountId: accountId!,
      defaultValidityType,
      defaultStartDate: body.defaultStartDate ? new Date(body.defaultStartDate) : null,
      defaultEndDate: body.defaultEndDate ? new Date(body.defaultEndDate) : null,
      defaultSlotStart: body.defaultSlotStart ?? null,
      defaultSlotEnd: body.defaultSlotEnd ?? null,
      defaultValidityDurationMinutes: body.defaultValidityDurationMinutes != null ? Number(body.defaultValidityDurationMinutes) : null,
      serviceAreas: areasPayload.length > 0 ? {
        create: areasPayload.map((a) => ({
          accessAreaId: a.areaId,
          defaultValidityType: ["DATE_RANGE", "TIME_SLOT", "DURATION"].includes(a.defaultValidityType ?? "") ? a.defaultValidityType : null,
          defaultStartDate: a.defaultStartDate ? new Date(a.defaultStartDate) : null,
          defaultEndDate: a.defaultEndDate ? new Date(a.defaultEndDate) : null,
          defaultSlotStart: a.defaultSlotStart ?? null,
          defaultSlotEnd: a.defaultSlotEnd ?? null,
          defaultValidityDurationMinutes: a.defaultValidityDurationMinutes != null ? a.defaultValidityDurationMinutes : null,
        })),
      } : undefined,
    },
    include: {
      serviceAreas: { include: { area: { select: { id: true, name: true } } } },
      _count: { select: { tickets: true } },
    },
  });
  return NextResponse.json(service, { status: 201 });
}
