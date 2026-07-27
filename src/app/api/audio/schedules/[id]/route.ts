import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { clampVolume, parseDaysOfWeek, parseTimeOfDay, parseZoneIds } from "@/lib/audio";

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

  const existing = await db.audioSchedule.findFirst({
    where: { id: scheduleId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();

  let zoneIds: number[] | undefined = undefined;
  if (body.zoneIds !== undefined) {
    const requested = parseZoneIds(body.zoneIds);
    if (requested.length === 0) {
      zoneIds = [];
    } else {
      const owned = await db.audioZone.findMany({
        where: { id: { in: requested }, accountId: accountId! },
        select: { id: true },
      });
      zoneIds = owned.map((z) => z.id);
    }
  }

  const schedule = await db.audioSchedule.update({
    where: { id: scheduleId },
    data: {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      daysOfWeek: body.daysOfWeek === undefined ? undefined : parseDaysOfWeek(body.daysOfWeek),
      timeOfDay: parseTimeOfDay(body.timeOfDay) ?? undefined,
      ...(zoneIds !== undefined ? { zoneIds } : {}),
      volume:
        existing.action === "VOLUME" && body.volume !== undefined
          ? clampVolume(body.volume, existing.volume ?? 50)
          : undefined,
    },
    include: {
      announcement: { select: { id: true, name: true } },
      playlist: { select: { id: true, name: true } },
    },
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

  const existing = await db.audioSchedule.findFirst({
    where: { id: scheduleId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.audioSchedule.delete({ where: { id: scheduleId } });
  return NextResponse.json({ ok: true });
}
