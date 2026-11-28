import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { isOperatingExtent } from "@/lib/operating-extent";
import {
  MAX_OPERATING_OFFSET_MINUTES,
  checkExternalReceivers,
  clampVolume,
  parseMusicSettings,
  parseOffsetMinutes,
  parseSourceKind,
  resolveOwnedStream,
  resolveZoneMonitor,
} from "@/lib/audio";
import { parseStreamUrl } from "@/lib/audio-integration";
import { resolveFollowZone } from "@/lib/audio-follow";
import { MAX_ZONE_NAME, cleanReceiverName } from "@/lib/net-address";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb({ requireAdmin: true });
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

  // Monitor-Seite als Abspieler: schließt den Pi aus. Wer eine Seite wählt,
  // löst damit den Pi und umgekehrt; beides zugleich geht nicht.
  const monitor = await resolveZoneMonitor(db, accountId!, body.monitorId, zoneId);
  if (monitor && "error" in monitor) {
    return NextResponse.json({ error: monitor.error }, { status: monitor.status });
  }
  let monitorId = monitor?.monitorId;
  if (monitorId != null && deviceId != null) {
    return NextResponse.json(
      { error: "Eine Zone spielt entweder über einen Audio-Pi oder über einen Monitor" },
      { status: 400 }
    );
  }
  if (monitorId != null && deviceId === undefined && existing.deviceId !== null) deviceId = null;
  if (deviceId != null && monitorId === undefined && existing.monitorId !== null) monitorId = null;

  // Folgt der Wiedergabe einer anderen Zone (keine Ketten). Ein Wechsel
  // beginnt den Abgleich von vorn.
  const follow = await resolveFollowZone(db, accountId!, body.followZoneId, zoneId);
  if (follow && "error" in follow) {
    return NextResponse.json({ error: follow.error }, { status: follow.status });
  }
  const followZoneId = follow?.followZoneId;
  const followChanged = followZoneId !== undefined && followZoneId !== existing.followZoneId;

  // Raum-Zuordnung analog.
  let keyRoomId: number | null | undefined = undefined;
  if (body.keyRoomId !== undefined) {
    if (body.keyRoomId === null || body.keyRoomId === "") {
      keyRoomId = null;
    } else {
      const candidate = Number(body.keyRoomId);
      const room = Number.isInteger(candidate)
        ? await db.keyRoom.findFirst({ where: { id: candidate, accountId: accountId! }, select: { id: true } })
        : null;
      if (!room) return NextResponse.json({ error: "Raum nicht gefunden" }, { status: 404 });
      keyRoomId = candidate;
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

  let streamId: number | null | undefined = undefined;
  let streamUrlFromStream: string | null | undefined = undefined;
  if (body.streamId !== undefined) {
    const stream = await resolveOwnedStream(db, accountId!, body.streamId);
    if (stream && "error" in stream) {
      return NextResponse.json({ error: stream.error }, { status: 400 });
    }
    streamId = stream?.id ?? null;
    streamUrlFromStream = stream?.url ?? null;
  }

  const sourceKind = parseSourceKind(body.sourceKind);
  const defaultSource = parseSourceKind(body.defaultSource);

  // Musikfenster: undefined = unverändert, sonst geprüfter Versatz.
  const musicOpenOffset =
    body.musicOpenOffset === undefined ? undefined : parseOffsetMinutes(body.musicOpenOffset);
  const musicCloseOffset =
    body.musicCloseOffset === undefined ? undefined : parseOffsetMinutes(body.musicCloseOffset);
  if (musicOpenOffset === null || musicCloseOffset === null) {
    return NextResponse.json(
      { error: `Verschiebung muss zwischen −${MAX_OPERATING_OFFSET_MINUTES} und ${MAX_OPERATING_OFFSET_MINUTES} Minuten liegen` },
      { status: 400 }
    );
  }
  const music = parseMusicSettings(body, existing);
  if ("error" in music) return NextResponse.json({ error: music.error }, { status: 400 });
  if (body.musicExtent !== undefined && !isOperatingExtent(body.musicExtent)) {
    return NextResponse.json({ error: "Reichweite der Betriebszeit unbekannt" }, { status: 400 });
  }
  const musicExtent = isOperatingExtent(body.musicExtent) ? body.musicExtent : undefined;

  const airplayEnabled =
    body.airplayEnabled === undefined ? undefined : body.airplayEnabled === true;
  const bluetoothEnabled =
    body.bluetoothEnabled === undefined ? undefined : body.bluetoothEnabled === true;
  const wantsAirplay = airplayEnabled ?? existing.airplayEnabled;
  const wantsBluetooth = bluetoothEnabled ?? existing.bluetoothEnabled;
  const effectiveDeviceId = deviceId !== undefined ? deviceId : existing.deviceId;
  const deviceChanged = deviceId !== undefined && deviceId !== existing.deviceId;

  // Nur neu eingeschaltete Empfänger prüfen, oder solche, die auf einen anderen
  // Abspieler umziehen. Ein unveränderter Schalter darf das Speichern nicht
  // blockieren – sonst ließe sich eine Zone nicht mehr bearbeiten, solange ihr
  // Pi offline ist und keine Backends gemeldet hat.
  const receiverError = await checkExternalReceivers(db, effectiveDeviceId, {
    airplay: wantsAirplay && (!existing.airplayEnabled || deviceChanged),
    bluetooth: wantsBluetooth && (!existing.bluetoothEnabled || deviceChanged),
  });
  if (receiverError) {
    return NextResponse.json({ error: receiverError }, { status: 400 });
  }

  // Eigene Stream-URL: eine neue muss http/https sein; leer loescht sie wie bisher.
  let streamUrl: string | null | undefined = undefined;
  if (streamId === undefined && body.streamUrl !== undefined) {
    streamUrl = null;
    if (typeof body.streamUrl === "string" && body.streamUrl.trim()) {
      streamUrl = body.streamUrl.trim();
      if (streamUrl !== existing.streamUrl) {
        const parsed = parseStreamUrl(streamUrl);
        if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
    }
  }

  // Der Name landet als AirPlay/Bluetooth-Name in der Konfiguration des
  // Abspielers; ein unveraenderter Name bleibt, wie er ist.
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const name = rawName === existing.name ? rawName : cleanReceiverName(rawName, MAX_ZONE_NAME);
  const externalName = typeof body.externalName === "string" ? cleanReceiverName(body.externalName) : "";

  const zone = await db.audioZone.update({
    where: { id: zoneId },
    data: {
      name: name || undefined,
      ...(deviceId !== undefined ? { deviceId } : {}),
      ...(monitorId !== undefined ? { monitorId } : {}),
      ...(followChanged ? { followZoneId, followState: null } : {}),
      ...(keyRoomId !== undefined ? { keyRoomId } : {}),
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
      ...(streamId !== undefined
        ? { streamId, streamUrl: streamUrlFromStream }
        : streamUrl === undefined
          ? {}
          : { streamUrl }),
      volume: body.volume === undefined ? undefined : clampVolume(body.volume, existing.volume),
      announcementVolume:
        body.announcementVolume === undefined
          ? undefined
          : clampVolume(body.announcementVolume, existing.announcementVolume),
      duckVolume:
        body.duckVolume === undefined
          ? undefined
          : clampVolume(body.duckVolume, existing.duckVolume),
      musicMode: music.musicMode,
      musicTimes: music.musicTimes,
      musicOpenOffset,
      musicCloseOffset,
      musicExtent,
      airplayEnabled,
      bluetoothEnabled,
      externalName: body.externalName === undefined ? undefined : externalName || null,
      // Ein abgeschalteter Empfänger darf keinen Übernahme-Hinweis und kein
      // offenes Kopplungsfenster hinterlassen.
      ...(wantsAirplay || wantsBluetooth ? {} : { externalActive: null, externalSender: null }),
      ...(wantsBluetooth ? {} : { pairableUntil: null }),
      sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : undefined,
    },
    include: {
      device: { select: { id: true, name: true, lastUpdate: true } },
      playlist: { select: { id: true, name: true } },
      stream: { select: { id: true, name: true } },
      keyRoom: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(zone);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb({ requireAdmin: true });
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
