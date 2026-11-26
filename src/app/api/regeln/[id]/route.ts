import { NextRequest, NextResponse } from "next/server";
import { getSessionOrApiToken } from "@/lib/api-auth";
import {
  replaceRuleActions,
  ruleInclude,
  validateRuleReferences,
} from "@/lib/room-rule-queries";
import { roomRuleUpdateSchema } from "@/lib/validators";
import { scheduleChanged, type RuleScheduleFields } from "@/lib/rule-due";

const SCHEDULE_SELECT = {
  id: true,
  trigger: true,
  timeOfDay: true,
  offsetMinutes: true,
  daysOfWeek: true,
  roomId: true,
  operatingScheduleId: true,
  operatingExtent: true,
  operating: true,
  windowStart: true,
  windowEnd: true,
  onlyWhenDark: true,
  isActive: true,
  lastOccurrenceAt: true,
} as const;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrApiToken(request, { requireAdmin: true });
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
    select: SCHEDULE_SELECT,
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const { actions, ...data } = parsed.data;
  // „Ruhe im Raum“ braucht eine Kamera im Raum; geprueft, wenn Ausloeser oder
  // Raum gespeichert werden (nicht beim reinen Ein- und Ausschalten).
  const touchesIdle = data.trigger !== undefined || data.roomId !== undefined;
  const problem = await validateRuleReferences(db, accountId, {
    ...data,
    actions,
    ...(touchesIdle
      ? { trigger: data.trigger ?? existing.trigger, roomId: data.roomId !== undefined ? data.roomId : existing.roomId }
      : {}),
  });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // Aendert sich der Zeitplan, holt die Regel Termine vor dieser Aenderung
  // nicht nach und meldet sie nicht (src/lib/rule-due.ts, scheduleChanged).
  const before: RuleScheduleFields = existing;
  const after: RuleScheduleFields = { ...before };
  for (const key of Object.keys(before) as Array<keyof RuleScheduleFields>) {
    const value = (data as Record<string, unknown>)[key];
    if (value !== undefined) (after as unknown as Record<string, unknown>)[key] = value;
  }
  const now = new Date();
  const watermark =
    scheduleChanged(before, after) && (!existing.lastOccurrenceAt || existing.lastOccurrenceAt < now) ? now : undefined;

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
      ...(data.operatingExtent !== undefined && { operatingExtent: data.operatingExtent }),
      ...(data.windowStart !== undefined && { windowStart: data.windowStart }),
      ...(data.windowEnd !== undefined && { windowEnd: data.windowEnd }),
      ...(data.onlyWhenDark !== undefined && { onlyWhenDark: data.onlyWhenDark }),
      ...(data.cooldownSeconds !== undefined && { cooldownSeconds: data.cooldownSeconds }),
      ...(watermark && { lastOccurrenceAt: watermark }),
      // Neue Regel-Version: Der Hub holt seinen Plan (src/lib/rule-version.ts).
      configChangedAt: now,
    },
    select: { id: true },
  });

  if (actions) await replaceRuleActions(db, ruleId, actions);

  const rule = await db.roomRule.findUnique({ where: { id: ruleId }, include: ruleInclude });
  return NextResponse.json(rule);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionOrApiToken(request, { requireAdmin: true });
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
