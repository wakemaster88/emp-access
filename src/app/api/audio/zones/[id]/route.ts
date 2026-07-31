import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { clampVolume, parseSourceKind, parseTimeOfDay } from "@/lib/audio";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const zoneId = Number(id);
  if (isNaN(zoneId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.audioZone.findFirst({
    where: { id: zoneId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();

  // Geräte-Zuordnung: undefined = unverändert, null/"" = lösen, sonst setzen.
  let deviceId: number | null | undefined = undefined;
  if (body.deviceId !== undefined) {
    if (body.deviceId === null || body.deviceId === "") {
      deviceId = null;
    } else {
      const candidate = Number(body.deviceId);
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
      if (taken && taken.id !== zoneId) {
        return NextResponse.json(
          { error: "Dieses Gerät ist bereits einer Zone zugeordnet" },
          { status: 409 }
        );
      }
      deviceId = candidate;
    }
  }

  // Playlist-Zuordnung analog.
  let playlistId: number | null | undefined = undefined;
  if (body.playlistId !== undefined) {
    if (body.playlistId === null || body.playlistId === "") {
      playlistId = null;
    } else {
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
  }

  const sourceKind = parseSourceKind(body.sourceKind);
  const defaultSource = parseSourceKind(body.defaultSource);

  const zone = await db.audioZone.update({
    where: { id: zoneId },
    data: {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      ...(deviceId !== undefined ? { deviceId } : {}),
      ...(playlistId !== undefined ? { playlistId } : {}),
      ...(sourceKind ? { sourceKind } : {}),
      ...(defaultSource ? { defaultSource } : {}),
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      syncGroup:
        body.syncGroup === undefined
          ? undefined
          : typeof body.syncGroup === "string" && body.syncGroup.trim()
            ? body.syncGroup.trim()
            : null,
      streamUrl:
        body.streamUrl === undefined
          ? undefined
          : typeof body.streamUrl === "string" && body.streamUrl.trim()
            ? body.streamUrl.trim()
            : null,
      volume: body.volume === undefined ? undefined : clampVolume(body.volume, existing.volume),
      announcementVolume:
        body.announcementVolume === undefined
          ? undefined
          : clampVolume(body.announcementVolume, existing.announcementVolume),
      duckVolume:
        body.duckVolume === undefined
          ? undefined
          : clampVolume(body.duckVolume, existing.duckVolume),
      quietFrom: body.quietFrom === undefined ? undefined : parseTimeOfDay(body.quietFrom),
      quietTo: body.quietTo === undefined ? undefined : parseTimeOfDay(body.quietTo),
      sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : undefined,
    },
    include: {
      device: { select: { id: true, name: true, lastUpdate: true } },
      playlist: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(zone);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const zoneId = Number(id);
  if (isNaN(zoneId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.audioZone.findFirst({
    where: { id: zoneId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.audioZone.delete({ where: { id: zoneId } });
  return NextResponse.json({ ok: true });
}
