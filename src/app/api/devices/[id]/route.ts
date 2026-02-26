import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const device = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId! },
    include: {
      _count: { select: { scans: true } },
    },
  });
  if (!device) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  return NextResponse.json(device);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const { db, accountId } = session;

  const existing = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const VALID_CATEGORIES = ["DREHKREUZ", "TUER", "SENSOR", "SCHALTER", "BELEUCHTUNG"];

  const device = await db.device.update({
    where: { id: deviceId },
    data: {
      name: body.name ?? existing.name,
      category: body.category !== undefined
        ? (body.category && VALID_CATEGORIES.includes(body.category) ? body.category : null)
        : existing.category,
      ipAddress: body.ipAddress ?? existing.ipAddress,
      shellyId: body.shellyId ?? existing.shellyId,
      shellyAuthKey: body.shellyAuthKey ?? existing.shellyAuthKey,
      isActive: body.isActive ?? existing.isActive,
      accessIn: body.accessIn ?? existing.accessIn,
      accessOut: body.accessOut ?? existing.accessOut,
      allowReentry: body.allowReentry ?? existing.allowReentry,
      firmware: body.firmware ?? existing.firmware,
      schedule: body.schedule !== undefined ? (body.schedule ?? null) : existing.schedule,
    },
  });

  return NextResponse.json(device);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const existing = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.device.delete({ where: { id: deviceId } });

  return NextResponse.json({ ok: true });
}
