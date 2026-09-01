import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  replaceRuleActions,
  ruleInclude,
  validateRuleReferences,
} from "@/lib/room-rule-queries";
import { roomRuleCreateSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const roomId = request.nextUrl.searchParams.get("roomId");
  const rules = await session.db.roomRule.findMany({
    where: {
      accountId: session.accountId,
      ...(roomId ? { roomId: Number(roomId) } : {}),
    },
    include: ruleInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(rules);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = roomRuleCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const { actions, ...data } = parsed.data;

  const problem = await validateRuleReferences(db, accountId, { ...data, actions });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const created = await db.roomRule.create({
    data: {
      accountId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      roomId: data.roomId ?? null,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
      trigger: data.trigger,
      daysOfWeek: data.daysOfWeek ?? 127,
      timeOfDay: data.timeOfDay ?? null,
      offsetMinutes: data.offsetMinutes ?? 0,
      cameraId: data.cameraId ?? null,
      eventType: data.eventType ?? null,
      triggerDeviceId: data.triggerDeviceId ?? null,
      triggerAction: data.triggerAction ?? null,
      areaId: data.areaId ?? null,
      scanDirection: data.scanDirection ?? null,
      idleMinutes: data.idleMinutes ?? null,
      operating: data.operating ?? "ANY",
      operatingScheduleId: data.operatingScheduleId ?? null,
      windowStart: data.windowStart ?? null,
      windowEnd: data.windowEnd ?? null,
      onlyWhenDark: data.onlyWhenDark ?? false,
      cooldownSeconds: data.cooldownSeconds ?? 60,
    },
    select: { id: true },
  });

  if (actions) await replaceRuleActions(db, created.id, actions);

  const rule = await db.roomRule.findUnique({
    where: { id: created.id },
    include: ruleInclude,
  });
  return NextResponse.json(rule, { status: 201 });
}
