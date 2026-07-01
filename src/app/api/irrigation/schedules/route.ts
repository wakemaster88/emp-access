import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

function clampMinutes(v: unknown, fallback = 15): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(180, Math.max(1, Math.round(n)));
}

function validStartTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : null;
}

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const schedules = await db.irrigationSchedule.findMany({
    where: { accountId: accountId! },
    include: { device: { select: { id: true, name: true } } },
    orderBy: [{ startTime: "asc" }],
  });
  return NextResponse.json(schedules);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();

  const deviceId = Number(body.deviceId);
  if (!Number.isFinite(deviceId)) {
    return NextResponse.json({ error: "deviceId erforderlich" }, { status: 400 });
  }

  const startTime = validStartTime(body.startTime);
  if (!startTime) {
    return NextResponse.json({ error: "Ungültige Startzeit (HH:mm)" }, { status: 400 });
  }

  // Gerät muss zum Account gehören und ein GARDENA-Ventil sein.
  const device = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId!, type: "GARDENA_VALVE" },
    select: { id: true },
  });
  if (!device) {
    return NextResponse.json({ error: "GARDENA-Gerät nicht gefunden" }, { status: 404 });
  }

  const daysOfWeek = Number.isFinite(Number(body.daysOfWeek))
    ? Math.max(0, Math.min(127, Math.round(Number(body.daysOfWeek))))
    : 127;

  const schedule = await db.irrigationSchedule.create({
    data: {
      accountId: accountId!,
      deviceId,
      daysOfWeek,
      startTime,
      durationMinutes: clampMinutes(body.durationMinutes),
      isActive: body.isActive ?? true,
      skipOnRain: body.skipOnRain ?? true,
    },
    include: { device: { select: { id: true, name: true } } },
  });

  return NextResponse.json(schedule, { status: 201 });
}
