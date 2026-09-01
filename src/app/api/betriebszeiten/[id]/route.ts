import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  clearOtherDefaults,
  replaceExceptions,
  replaceSeasons,
  scheduleInclude,
} from "@/lib/operating-queries";
import { operatingScheduleUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const scheduleId = Number((await params).id);
  if (isNaN(scheduleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = operatingScheduleUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.operatingSchedule.findFirst({
    where: { id: scheduleId, accountId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  await db.operatingSchedule.update({
    where: { id: scheduleId },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.description !== undefined && { description: data.description?.trim() || null }),
      ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
    },
    select: { id: true },
  });

  if (data.seasons) await replaceSeasons(db, scheduleId, data.seasons);
  if (data.exceptions) await replaceExceptions(db, scheduleId, data.exceptions);
  if (data.isDefault) await clearOtherDefaults(db, accountId, scheduleId);

  const schedule = await db.operatingSchedule.findUnique({
    where: { id: scheduleId },
    include: scheduleInclude,
  });
  return NextResponse.json(schedule);
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

  const scheduleId = Number((await params).id);
  if (isNaN(scheduleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.operatingSchedule.findFirst({
    where: { id: scheduleId, accountId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Räume behalten ihre Zuordnung nicht (onDelete: SetNull) und gelten danach
  // wieder als dauerhaft verfügbar.
  await db.operatingSchedule.delete({ where: { id: scheduleId } });
  return NextResponse.json({ ok: true });
}
