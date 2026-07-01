import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

function clampMinutes(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(180, Math.max(1, Math.round(n)));
}

function validStartTime(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : undefined;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const scheduleId = Number(id);
  if (isNaN(scheduleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.irrigationSchedule.findFirst({
    where: { id: scheduleId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const startTime = validStartTime(body.startTime);
  const durationMinutes = clampMinutes(body.durationMinutes);
  const daysOfWeek = Number.isFinite(Number(body.daysOfWeek))
    ? Math.max(0, Math.min(127, Math.round(Number(body.daysOfWeek))))
    : undefined;

  const schedule = await db.irrigationSchedule.update({
    where: { id: scheduleId },
    data: {
      startTime: startTime ?? existing.startTime,
      durationMinutes: durationMinutes ?? existing.durationMinutes,
      daysOfWeek: daysOfWeek ?? existing.daysOfWeek,
      isActive: body.isActive ?? existing.isActive,
      skipOnRain: body.skipOnRain ?? existing.skipOnRain,
    },
    include: { device: { select: { id: true, name: true } } },
  });

  return NextResponse.json(schedule);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const scheduleId = Number(id);
  if (isNaN(scheduleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.irrigationSchedule.findFirst({
    where: { id: scheduleId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.irrigationSchedule.delete({ where: { id: scheduleId } });
  return NextResponse.json({ ok: true });
}
