import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  clearOtherDefaults,
  replaceExceptions,
  replaceSeasons,
  scheduleInclude,
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
  const session = await getSessionWithDb();
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

  const created = await db.operatingSchedule.create({
    data: {
      accountId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      isDefault: data.isDefault ?? false,
      sortOrder: data.sortOrder ?? 0,
    },
    select: { id: true },
  });

  if (data.seasons) await replaceSeasons(db, created.id, data.seasons);
  if (data.exceptions) await replaceExceptions(db, created.id, data.exceptions);
  if (data.isDefault) await clearOtherDefaults(db, accountId, created.id);

  const schedule = await db.operatingSchedule.findUnique({
    where: { id: created.id },
    include: scheduleInclude,
  });
  return NextResponse.json(schedule, { status: 201 });
}
