import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { shellyAutomationCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const automations = await db.shellyAutomation.findMany({
    where: { accountId: accountId! },
    include: {
      group: { select: { id: true, name: true } },
      camera: { select: { id: true, name: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(automations);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  const parsed = shellyAutomationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify group belongs to account
  const group = await db.shellyGroup.findFirst({
    where: { id: parsed.data.groupId, accountId: accountId! },
    select: { id: true },
  });
  if (!group) {
    return NextResponse.json({ error: "Gruppe nicht gefunden" }, { status: 400 });
  }

  const isCamera = parsed.data.trigger === "CAMERA_EVENT";
  if (isCamera && parsed.data.cameraId) {
    const camera = await db.camera.findFirst({
      where: { id: parsed.data.cameraId, accountId: accountId! },
      select: { id: true },
    });
    if (!camera) {
      return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 400 });
    }
  }

  const automation = await db.shellyAutomation.create({
    data: {
      accountId: accountId!,
      groupId: parsed.data.groupId,
      name: parsed.data.name,
      trigger: parsed.data.trigger,
      isActive: parsed.data.isActive ?? true,
      daysOfWeek: parsed.data.daysOfWeek ?? 127,
      timeOfDay: isCamera ? null : (parsed.data.timeOfDay ?? null),
      offsetMinutes: isCamera ? 0 : (parsed.data.offsetMinutes ?? 0),
      cameraId: isCamera ? parsed.data.cameraId! : null,
      eventType: isCamera ? (parsed.data.eventType ?? "PERSON") : null,
      windowStart: isCamera ? parsed.data.windowStart! : null,
      windowEnd: isCamera ? parsed.data.windowEnd! : null,
      cooldownMinutes: isCamera ? (parsed.data.cooldownMinutes ?? 5) : 5,
    },
    include: {
      group: { select: { id: true, name: true } },
      camera: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(automation, { status: 201 });
}
