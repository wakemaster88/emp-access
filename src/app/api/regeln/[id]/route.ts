import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  replaceRuleActions,
  ruleInclude,
  validateRuleReferences,
} from "@/lib/room-rule-queries";
import { roomRuleUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const ruleId = Number((await params).id);
  if (isNaN(ruleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = roomRuleUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.roomRule.findFirst({
    where: { id: ruleId, accountId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const { actions, ...data } = parsed.data;
  const problem = await validateRuleReferences(db, accountId, { ...data, actions });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  await db.roomRule.update({
    where: { id: ruleId },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.description !== undefined && { description: data.description?.trim() || null }),
      ...(data.roomId !== undefined && { roomId: data.roomId }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      ...(data.trigger !== undefined && { trigger: data.trigger }),
      ...(data.daysOfWeek !== undefined && { daysOfWeek: data.daysOfWeek }),
      ...(data.timeOfDay !== undefined && { timeOfDay: data.timeOfDay }),
      ...(data.offsetMinutes !== undefined && { offsetMinutes: data.offsetMinutes }),
      ...(data.cameraId !== undefined && { cameraId: data.cameraId }),
      ...(data.eventType !== undefined && { eventType: data.eventType }),
      ...(data.triggerDeviceId !== undefined && { triggerDeviceId: data.triggerDeviceId }),
      ...(data.triggerAction !== undefined && { triggerAction: data.triggerAction }),
      ...(data.areaId !== undefined && { areaId: data.areaId }),
      ...(data.scanDirection !== undefined && { scanDirection: data.scanDirection }),
      ...(data.idleMinutes !== undefined && { idleMinutes: data.idleMinutes }),
      ...(data.operating !== undefined && { operating: data.operating }),
      ...(data.operatingScheduleId !== undefined && {
        operatingScheduleId: data.operatingScheduleId,
      }),
      ...(data.windowStart !== undefined && { windowStart: data.windowStart }),
      ...(data.windowEnd !== undefined && { windowEnd: data.windowEnd }),
      ...(data.onlyWhenDark !== undefined && { onlyWhenDark: data.onlyWhenDark }),
      ...(data.cooldownSeconds !== undefined && { cooldownSeconds: data.cooldownSeconds }),
    },
    select: { id: true },
  });

  if (actions) await replaceRuleActions(db, ruleId, actions);

  const rule = await db.roomRule.findUnique({ where: { id: ruleId }, include: ruleInclude });
  return NextResponse.json(rule);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const ruleId = Number((await params).id);
  if (isNaN(ruleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.roomRule.findFirst({
    where: { id: ruleId, accountId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Der Verlauf bleibt stehen (onDelete: SetNull) und behält den Regelnamen.
  await db.roomRule.delete({ where: { id: ruleId } });
  return NextResponse.json({ ok: true });
}
