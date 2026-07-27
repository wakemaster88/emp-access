import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { clampVolume, parseTimeOfDay } from "@/lib/audio";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const zones = await db.audioZone.findMany({
    where: { accountId: accountId! },
    include: {
      device: { select: { id: true, name: true, lastUpdate: true } },
      playlist: { select: { id: true, name: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(zones);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name erforderlich" }, { status: 400 });
  }

  // Abspieler ist optional: Zonen dürfen vor der Hardware angelegt werden.
  let deviceId: number | null = null;
  if (body.deviceId != null && body.deviceId !== "") {
    const candidate = Number(body.deviceId);
    if (!Number.isInteger(candidate)) {
      return NextResponse.json({ error: "Ungültige Geräte-ID" }, { status: 400 });
    }
    const device = await db.device.findFirst({
      where: { id: candidate, accountId: accountId!, type: "AUDIO_PLAYER" },
      select: { id: true },
    });
    if (!device) {
      return NextResponse.json({ error: "Audio-Gerät nicht gefunden" }, { status: 404 });
    }
    const taken = await db.audioZone.findUnique({
      where: { deviceId: candidate },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json(
        { error: "Dieses Gerät ist bereits einer Zone zugeordnet" },
        { status: 409 }
      );
    }
    deviceId = candidate;
  }

  const last = await db.audioZone.findFirst({
    where: { accountId: accountId! },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const zone = await db.audioZone.create({
    data: {
      accountId: accountId!,
      name,
      deviceId,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      syncGroup:
        typeof body.syncGroup === "string" && body.syncGroup.trim()
          ? body.syncGroup.trim()
          : null,
      volume: clampVolume(body.volume, 50),
      announcementVolume: clampVolume(body.announcementVolume, 85),
      duckVolume: clampVolume(body.duckVolume, 15),
      quietFrom: parseTimeOfDay(body.quietFrom),
      quietTo: parseTimeOfDay(body.quietTo),
    },
    include: {
      device: { select: { id: true, name: true, lastUpdate: true } },
      playlist: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(zone, { status: 201 });
}
