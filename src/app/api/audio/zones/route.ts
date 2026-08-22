import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  checkExternalReceivers,
  clampVolume,
  parseSourceKind,
  parseTimeOfDay,
  resolveOwnedStream,
} from "@/lib/audio";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const zones = await db.audioZone.findMany({
    where: { accountId: accountId! },
    include: {
      device: { select: { id: true, name: true, lastUpdate: true } },
      playlist: { select: { id: true, name: true } },
      stream: { select: { id: true, name: true } },
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

  // Playlist ist optional; sie muss aber demselben Mandanten gehoeren.
  let playlistId: number | null = null;
  if (body.playlistId != null && body.playlistId !== "") {
    const candidate = Number(body.playlistId);
    const playlist = await db.audioPlaylist.findFirst({
      where: { id: candidate, accountId: accountId! },
      select: { id: true },
    });
    if (!playlist) {
      return NextResponse.json({ error: "Playlist nicht gefunden" }, { status: 404 });
    }
    playlistId = candidate;
  }

  let streamId: number | null = null;
  let streamUrl: string | null = null;
  if (body.streamId != null && body.streamId !== "") {
    const stream = await resolveOwnedStream(db, accountId!, body.streamId);
    if (stream && "error" in stream) {
      return NextResponse.json({ error: stream.error }, { status: 400 });
    }
    if (stream) {
      streamId = stream.id;
      streamUrl = stream.url;
    }
  } else if (typeof body.streamUrl === "string" && body.streamUrl.trim()) {
    streamUrl = body.streamUrl.trim();
  }

  // AirPlay/Bluetooth nur zulassen, wenn der Abspieler die Dienste gemeldet
  // hat – sonst speichert man eine Einstellung, die der Pi still ignoriert.
  const airplayEnabled = body.airplayEnabled === true;
  const bluetoothEnabled = body.bluetoothEnabled === true;
  const receiverError = await checkExternalReceivers(db, deviceId, {
    airplay: airplayEnabled,
    bluetooth: bluetoothEnabled,
  });
  if (receiverError) {
    return NextResponse.json({ error: receiverError }, { status: 400 });
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
      playlistId,
      streamId,
      defaultSource: parseSourceKind(body.defaultSource) ?? "PLAYLIST",
      streamUrl,
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
      airplayEnabled,
      bluetoothEnabled,
      externalName:
        typeof body.externalName === "string" && body.externalName.trim()
          ? body.externalName.trim().slice(0, 60)
          : null,
    },
    include: {
      device: { select: { id: true, name: true, lastUpdate: true } },
      playlist: { select: { id: true, name: true } },
      stream: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(zone, { status: 201 });
}
