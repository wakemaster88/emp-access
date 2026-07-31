/**
 * Direktsteuerung einer Zone aus dem Dashboard: Musik starten, stoppen,
 * Lautstärke ändern oder den lokalen Dateicache des Pi abgleichen.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { clampVolume, playlistPayload, queueZoneCommand } from "@/lib/audio";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const zoneId = Number(id);
  if (isNaN(zoneId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const zone = await db.audioZone.findFirst({
    where: { id: zoneId, accountId: accountId! },
  });
  if (!zone) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const action = body.action;

  if (action === "STOP") {
    await queueZoneCommand(db, accountId!, [zone], "STOP", null, "MANUAL");
    await db.audioZone.update({
      where: { id: zoneId },
      data: { sourceKind: "SILENCE" },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "VOLUME") {
    const volume = clampVolume(body.volume, zone.volume);
    await queueZoneCommand(db, accountId!, [zone], "VOLUME", { volume }, "MANUAL");
    await db.audioZone.update({ where: { id: zoneId }, data: { volume } });
    return NextResponse.json({ ok: true, volume });
  }

  if (action === "SYNC_LIBRARY") {
    await queueZoneCommand(db, accountId!, [zone], "SYNC_LIBRARY", null, "MANUAL");
    return NextResponse.json({ ok: true });
  }

  if (action === "PLAY") {
    // Ohne ausdrückliche Angabe entscheidet die eingestellte Quelle der Zone.
    // Der Ist-Zustand (sourceKind) zählt hier bewusst nicht, sonst würde eine
    // umgestellte Quelle erst nach dem nächsten Stopp greifen.
    const source =
      body.streamUrl != null
        ? "STREAM"
        : body.playlistId != null
          ? "PLAYLIST"
          : zone.defaultSource;

    if (source === "SILENCE") {
      return NextResponse.json(
        { error: "Für diese Zone ist keine Quelle eingestellt" },
        { status: 400 },
      );
    }

    if (source === "STREAM") {
      const streamUrl =
        typeof body.streamUrl === "string" && body.streamUrl.trim()
          ? body.streamUrl.trim()
          : zone.streamUrl;
      if (!streamUrl) {
        return NextResponse.json({ error: "Keine Stream-URL hinterlegt" }, { status: 400 });
      }
      await queueZoneCommand(
        db,
        accountId!,
        [zone],
        "PLAY",
        { kind: "STREAM", url: streamUrl, volume: zone.volume },
        "MANUAL"
      );
      await db.audioZone.update({
        where: { id: zoneId },
        data: { sourceKind: "STREAM", streamUrl },
      });
      return NextResponse.json({ ok: true });
    }

    const playlistId = body.playlistId != null ? Number(body.playlistId) : zone.playlistId;
    if (!playlistId) {
      return NextResponse.json({ error: "Keine Playlist ausgewählt" }, { status: 400 });
    }
    const owned = await db.audioPlaylist.findFirst({
      where: { id: playlistId, accountId: accountId! },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Playlist nicht gefunden" }, { status: 404 });

    const payload = await playlistPayload(db, playlistId);
    if (!payload) return NextResponse.json({ error: "Playlist nicht gefunden" }, { status: 404 });

    await queueZoneCommand(
      db,
      accountId!,
      [zone],
      "PLAY",
      { kind: "PLAYLIST", volume: zone.volume, ...(payload as object) },
      "MANUAL"
    );
    await db.audioZone.update({
      where: { id: zoneId },
      data: { sourceKind: "PLAYLIST", playlistId },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
}
