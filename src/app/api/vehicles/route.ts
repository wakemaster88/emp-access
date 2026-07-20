import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { allowedVehicleCreateSchema } from "@/lib/validators";
import { formatPlateDisplay, normalizePlate } from "@/lib/vehicles";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const vehicles = await db.allowedVehicle.findMany({
    where: { accountId: accountId! },
    include: {
      shellyDevice: { select: { id: true, name: true } },
      _count: { select: { sightings: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(vehicles);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  const parsed = allowedVehicleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const plate = formatPlateDisplay(parsed.data.plate);
  const plateNormalized = normalizePlate(plate);
  if (plateNormalized.length < 2) {
    return NextResponse.json({ error: "Ungültiges Kennzeichen" }, { status: 400 });
  }

  if (parsed.data.shellyDeviceId) {
    const device = await db.device.findFirst({
      where: { id: parsed.data.shellyDeviceId, accountId: accountId!, type: "SHELLY" },
      select: { id: true },
    });
    if (!device) {
      return NextResponse.json({ error: "Shelly nicht gefunden" }, { status: 400 });
    }
  }

  const existing = await db.allowedVehicle.findUnique({
    where: {
      accountId_plateNormalized: { accountId: accountId!, plateNormalized },
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ein Fahrzeug mit diesem Kennzeichen existiert bereits" },
      { status: 400 }
    );
  }

  const vehicle = await db.allowedVehicle.create({
    data: {
      accountId: accountId!,
      name: parsed.data.name.trim(),
      plate,
      plateNormalized,
      isActive: parsed.data.isActive ?? true,
      notes: parsed.data.notes?.trim() || null,
      shellyDeviceId: parsed.data.shellyDeviceId ?? null,
      shellyAction: parsed.data.shellyAction ?? "ON",
      timerSeconds: parsed.data.timerSeconds ?? null,
      cooldownMinutes: parsed.data.cooldownMinutes ?? 2,
    },
    include: {
      shellyDevice: { select: { id: true, name: true } },
      _count: { select: { sightings: true } },
    },
  });
  return NextResponse.json(vehicle, { status: 201 });
}
