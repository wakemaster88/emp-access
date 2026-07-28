import { NextRequest, NextResponse } from "next/server";
import { ValidityType } from "@prisma/client";
import { getSessionWithDb } from "@/lib/api-auth";

function toValidityType(v: string | null | undefined): ValidityType | null {
  return v && ["DATE_RANGE", "TIME_SLOT", "DURATION"].includes(v) ? (v as ValidityType) : null;
}

/**
 * Plaetze pro Slot, die EMP selbst verwaltet. Leer / 0 / ungueltig = NULL,
 * dann bleibt ANNYs Verfuegbarkeit maßgeblich.
 */
export function parseSlotCapacity(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

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

  // mainAccessAreaId muss Teil der areasPayload-Liste sein, sonst wuerde
  // der Pi-Scanner die Hauptressource an einem Gate erwarten, das gar nicht
  // zum Service gehoert. NULL ist immer erlaubt (= kein Default).
  const rawMainAreaId = body.mainAccessAreaId != null ? Number(body.mainAccessAreaId) : null;
  const mainAccessAreaId = rawMainAreaId != null
    && areasPayload.some((a) => Number(a.areaId) === rawMainAreaId)
    ? rawMainAreaId
    : null;

  const slotCapacity = parseSlotCapacity(body.slotCapacity);

  const service = await db.service.create({
    data: {
      name: body.name.trim(),
      annyNames: annyNames.length > 0 ? JSON.stringify(annyNames) : null,
      slotCapacity,
      accountId: accountId!,
      defaultValidityType,
      defaultStartDate: body.defaultStartDate ? new Date(body.defaultStartDate) : null,
      defaultEndDate: body.defaultEndDate ? new Date(body.defaultEndDate) : null,
      defaultSlotStart: body.defaultSlotStart ?? null,
      defaultSlotEnd: body.defaultSlotEnd ?? null,
      defaultValidityDurationMinutes: body.defaultValidityDurationMinutes != null ? Number(body.defaultValidityDurationMinutes) : null,
      allowReentry: !!body.allowReentry,
      allowManualCheckin: body.allowManualCheckin !== false,
      requiresPhoto: !!body.requiresPhoto,
      requiresRfid: !!body.requiresRfid,
      mainAccessAreaId,
      serviceAreas: areasPayload.length > 0 ? {
        create: areasPayload.map((a) => ({
          accessAreaId: a.areaId,
          defaultValidityType: toValidityType(a.defaultValidityType),
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
