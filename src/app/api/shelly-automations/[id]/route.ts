import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { shellyAutomationUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const body = await request.json();
  const parsed = shellyAutomationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await db.shellyAutomation.findFirst({
    where: { id: Number(id), accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  if (parsed.data.groupId !== undefined) {
    const group = await db.shellyGroup.findFirst({
      where: { id: parsed.data.groupId, accountId: accountId! },
      select: { id: true },
    });
    if (!group) {
      return NextResponse.json({ error: "Gruppe nicht gefunden" }, { status: 400 });
    }
  }

  if (parsed.data.cameraId != null) {
    const camera = await db.camera.findFirst({
      where: { id: parsed.data.cameraId, accountId: accountId! },
      select: { id: true },
    });
    if (!camera) {
      return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 400 });
    }
  }

  const updated = await db.shellyAutomation.update({
    where: { id: Number(id) },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.groupId !== undefined ? { groupId: parsed.data.groupId } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(parsed.data.trigger !== undefined ? { trigger: parsed.data.trigger } : {}),
      ...(parsed.data.daysOfWeek !== undefined ? { daysOfWeek: parsed.data.daysOfWeek } : {}),
      ...(parsed.data.timeOfDay !== undefined ? { timeOfDay: parsed.data.timeOfDay } : {}),
      ...(parsed.data.offsetMinutes !== undefined ? { offsetMinutes: parsed.data.offsetMinutes } : {}),
      ...(parsed.data.cameraId !== undefined ? { cameraId: parsed.data.cameraId } : {}),
      ...(parsed.data.eventType !== undefined ? { eventType: parsed.data.eventType } : {}),
      ...(parsed.data.windowStart !== undefined ? { windowStart: parsed.data.windowStart } : {}),
      ...(parsed.data.windowEnd !== undefined ? { windowEnd: parsed.data.windowEnd } : {}),
      ...(parsed.data.cooldownMinutes !== undefined ? { cooldownMinutes: parsed.data.cooldownMinutes } : {}),
    },
    include: {
      group: { select: { id: true, name: true } },
      camera: { select: { id: true, name: true } },
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

  const res = await db.shellyAutomation.deleteMany({
    where: { id: Number(id), accountId: accountId! },
  });
  if (res.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ success: true });
}
