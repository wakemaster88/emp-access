import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { listedPersonUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const existing = await db.listedPerson.findFirst({
    where: { id: Number(id), accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const parsed = listedPersonUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.cameraId) {
    const camera = await db.camera.findFirst({
      where: { id: parsed.data.cameraId, accountId: accountId! },
      select: { id: true },
    });
    if (!camera) return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 400 });
  }
  if (parsed.data.shellyDeviceId) {
    const device = await db.device.findFirst({
      where: { id: parsed.data.shellyDeviceId, accountId: accountId!, type: "SHELLY" },
      select: { id: true },
    });
    if (!device) return NextResponse.json({ error: "Shelly nicht gefunden" }, { status: 400 });
  }

  const updated = await db.listedPerson.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.listType !== undefined ? { listType: parsed.data.listType } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes?.trim() || null } : {}),
      ...(parsed.data.cameraId !== undefined ? { cameraId: parsed.data.cameraId } : {}),
      ...(parsed.data.trackHistory !== undefined ? { trackHistory: parsed.data.trackHistory } : {}),
      ...(parsed.data.triggerOnDetection !== undefined
        ? { triggerOnDetection: parsed.data.triggerOnDetection }
        : {}),
      ...(parsed.data.shellyDeviceId !== undefined
        ? { shellyDeviceId: parsed.data.shellyDeviceId }
        : {}),
      ...(parsed.data.shellyAction !== undefined ? { shellyAction: parsed.data.shellyAction } : {}),
      ...(parsed.data.timerSeconds !== undefined ? { timerSeconds: parsed.data.timerSeconds } : {}),
      ...(parsed.data.cooldownMinutes !== undefined
        ? { cooldownMinutes: parsed.data.cooldownMinutes }
        : {}),
    },
    include: {
      camera: { select: { id: true, name: true } },
      shellyDevice: { select: { id: true, name: true } },
      _count: { select: { sightings: true } },
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const res = await db.listedPerson.deleteMany({
    where: { id: Number(id), accountId: accountId! },
  });
  if (res.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ success: true });
}
