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

  // Sensor-Zuordnung: undefined = unveraendert, ""/null = entfernen, sonst setzen.
  let sensorServiceId = existing.sensorServiceId;
  if (body.sensorServiceId !== undefined) {
    sensorServiceId =
      typeof body.sensorServiceId === "string" && body.sensorServiceId.trim()
        ? body.sensorServiceId.trim()
        : null;
  }
  let moistureThresholdPct = existing.moistureThresholdPct;
  if (body.moistureThresholdPct !== undefined) {
    const n = Number(body.moistureThresholdPct);
    moistureThresholdPct = Number.isFinite(n) ? Math.min(95, Math.max(5, Math.round(n))) : null;
  }
  if (!sensorServiceId) moistureThresholdPct = null;
  else if (moistureThresholdPct == null) moistureThresholdPct = 60;

  // Ventil-Sequenz: undefined = unveraendert, []/null = entfernen, sonst setzen.
  let valveSequence: number[] | null | undefined = undefined;
  if (body.valveSequence !== undefined) {
    if (Array.isArray(body.valveSequence) && body.valveSequence.length > 0) {
      const ids = body.valveSequence.map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
      const found = await db.device.findMany({
        where: { id: { in: ids }, accountId: accountId!, type: "GARDENA_VALVE" },
        select: { id: true },
      });
      const valid = new Set(found.map((d) => d.id));
      const filtered = ids.filter((n: number) => valid.has(n) && n !== existing.deviceId);
      valveSequence = filtered.length > 0 ? filtered : null;
    } else {
      valveSequence = null;
    }
  }

  const schedule = await db.irrigationSchedule.update({
    where: { id: scheduleId },
    data: {
      startTime: startTime ?? existing.startTime,
      durationMinutes: durationMinutes ?? existing.durationMinutes,
      daysOfWeek: daysOfWeek ?? existing.daysOfWeek,
      isActive: body.isActive ?? existing.isActive,
      skipOnRain: body.skipOnRain ?? existing.skipOnRain,
      smartRain: body.smartRain ?? existing.smartRain,
      sensorServiceId,
      moistureThresholdPct,
      ...(valveSequence !== undefined
        ? { valveSequence: valveSequence === null ? { set: null } : valveSequence }
        : {}),
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
