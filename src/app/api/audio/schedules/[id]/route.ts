import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { clampVolume, parseDaysOfWeek, parseZoneIds } from "@/lib/audio";
import { parseScheduleTiming, scheduleResponseInclude } from "@/lib/audio-schedule-input";

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

  // Zeitpunkt nur pruefen, wenn er mitgeschickt wird – ein reines
  // Ein-/Ausschalten aus der Liste soll ohne Zeitangaben auskommen.
  const timingSent =
    body.trigger !== undefined ||
    body.timeOfDay !== undefined ||
    body.offsetMinutes !== undefined ||
    body.operatingScheduleId !== undefined ||
    body.operating !== undefined;
  const timing = timingSent ? await parseScheduleTiming(db, accountId!, body, existing) : null;
  if (timing && "error" in timing) {
    return NextResponse.json({ error: timing.error }, { status: 400 });
  }

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
      ...(timing ?? {}),
      ...(zoneIds !== undefined ? { zoneIds } : {}),
      volume:
        existing.action === "VOLUME" && body.volume !== undefined
          ? clampVolume(body.volume, existing.volume ?? 50)
          : undefined,
    },
    include: scheduleResponseInclude,
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
