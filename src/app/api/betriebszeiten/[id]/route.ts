import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { cleanFacilities } from "@/lib/facility-overlap";
import {
  checkParent,
  clashError,
  clashesForCandidate,
  clearOtherDefaults,
  exceptionInputsToSpec,
  replaceExceptions,
  replaceSeasons,
  scheduleInclude,
  scheduleSpecInclude,
  seasonInputsToSpec,
  toScheduleSpec,
} from "@/lib/operating-queries";
import { operatingScheduleUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb({ requireAdmin: true });
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
    include: scheduleSpecInclude,
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  const parentId = data.parentId !== undefined ? data.parentId : existing.parentId;
  if (data.parentId !== undefined) {
    const parentError = await checkParent(db, accountId, scheduleId, data.parentId);
    if (parentError) return NextResponse.json({ error: parentError }, { status: 400 });
  }

  // Stand nach dem Speichern auf doppelte Belegung der Anlagen prüfen.
  const current = toScheduleSpec(existing);
  const name = data.name?.trim() ?? existing.name;
  const clashes = await clashesForCandidate(db, accountId, {
    id: scheduleId,
    name,
    facilities: data.facilities ? cleanFacilities(data.facilities) : existing.facilities,
    shared: data.sharedTime ?? existing.sharedTime,
    spec: {
      name,
      seasons: data.seasons ? seasonInputsToSpec(data.seasons) : current.seasons,
      exceptions: data.exceptions ? exceptionInputsToSpec(data.exceptions) : current.exceptions,
    },
  });
  if (clashes.length > 0) {
    return NextResponse.json({ error: clashError(clashes), clashes }, { status: 409 });
  }

  // Ein Unterprofil ist nie die Vorbelegung für neue Räume.
  const isDefault = parentId != null ? false : data.isDefault;
  await db.operatingSchedule.update({
    where: { id: scheduleId },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.description !== undefined && { description: data.description?.trim() || null }),
      ...(isDefault !== undefined && { isDefault }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      ...(data.parentId !== undefined && { parentId: data.parentId }),
      ...(data.facilities !== undefined && { facilities: cleanFacilities(data.facilities) }),
      ...(data.annyResourceId !== undefined && { annyResourceId: data.annyResourceId }),
      ...(data.sharedTime !== undefined && { sharedTime: data.sharedTime }),
    },
    select: { id: true },
  });

  if (data.seasons) await replaceSeasons(db, scheduleId, data.seasons);
  if (data.exceptions) await replaceExceptions(db, scheduleId, data.exceptions);
  if (isDefault) await clearOtherDefaults(db, accountId, scheduleId);

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
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const scheduleId = Number((await params).id);
  if (isNaN(scheduleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.operatingSchedule.findFirst({
    where: { id: scheduleId, accountId },
    select: { id: true, _count: { select: { children: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  // Sonst rutschten die Unterprofile als eigene Bereiche in die Kunden-App.
  if (existing._count.children > 0) {
    return NextResponse.json(
      { error: "Das Profil hat Unterprofile. Bitte diese zuerst löschen oder einem anderen Profil zuordnen." },
      { status: 409 },
    );
  }

  // Räume behalten ihre Zuordnung nicht (onDelete: SetNull) und gelten danach
  // wieder als dauerhaft verfügbar.
  await db.operatingSchedule.delete({ where: { id: scheduleId } });
  return NextResponse.json({ ok: true });
}
