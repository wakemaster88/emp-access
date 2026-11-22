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
  seasonInputsToSpec,
} from "@/lib/operating-queries";
import { operatingScheduleCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const schedules = await session.db.operatingSchedule.findMany({
    where: { accountId: session.accountId },
    include: scheduleInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(schedules);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = operatingScheduleCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;
  const parentId = data.parentId ?? null;
  const facilities = cleanFacilities(data.facilities ?? []);

  const parentError = await checkParent(db, accountId, null, parentId);
  if (parentError) return NextResponse.json({ error: parentError }, { status: 400 });

  // Anlagen dürfen nicht doppelt belegt werden – vor dem Schreiben prüfen.
  const clashes = await clashesForCandidate(db, accountId, {
    id: -1,
    name: data.name.trim(),
    facilities,
    spec: {
      name: data.name.trim(),
      seasons: seasonInputsToSpec(data.seasons ?? []),
      exceptions: exceptionInputsToSpec(data.exceptions ?? []),
    },
  });
  if (clashes.length > 0) {
    return NextResponse.json({ error: clashError(clashes), clashes }, { status: 409 });
  }

  const created = await db.operatingSchedule.create({
    data: {
      accountId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      // Ein Unterprofil ist nie die Vorbelegung für neue Räume.
      isDefault: parentId == null && (data.isDefault ?? false),
      sortOrder: data.sortOrder ?? 0,
      parentId,
      facilities,
      annyResourceId: data.annyResourceId ?? null,
    },
    select: { id: true },
  });

  if (data.seasons) await replaceSeasons(db, created.id, data.seasons);
  if (data.exceptions) await replaceExceptions(db, created.id, data.exceptions);
  if (data.isDefault && parentId == null) await clearOtherDefaults(db, accountId, created.id);

  const schedule = await db.operatingSchedule.findUnique({
    where: { id: created.id },
    include: scheduleInclude,
  });
  return NextResponse.json(schedule, { status: 201 });
}
