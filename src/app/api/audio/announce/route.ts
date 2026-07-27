/**
 * Sofort-Durchsage aus dem Dashboard – entweder als Text (wird zu Sprache
 * gerendert) oder als bereits hochgeladene Aufnahme (Live-Durchsage aus dem
 * Browser). Es entsteht ein nicht-Vorlagen-Datensatz, damit die Durchsage im
 * Verlauf nachvollziehbar bleibt.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  MAX_ANNOUNCEMENT_CHARS,
  TtsNotConfiguredError,
  parseZoneIds,
  queueAnnouncement,
  renderTtsTrack,
  resolveTargetZones,
} from "@/lib/audio";

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();

  const zones = await resolveTargetZones(db, accountId!, parseZoneIds(body.zoneIds));
  if (zones.length === 0) {
    return NextResponse.json({ error: "Keine aktive Zielzone" }, { status: 400 });
  }

  const isRecording = typeof body.url === "string" && /^https?:\/\//i.test(body.url);
  const text =
    typeof body.text === "string" && body.text.trim()
      ? body.text.trim().slice(0, MAX_ANNOUNCEMENT_CHARS)
      : null;

  if (!isRecording && !text) {
    return NextResponse.json({ error: "Ansagetext oder Aufnahme erforderlich" }, { status: 400 });
  }

  let track: { id: number; url: string; durationSec: number | null };

  if (isRecording) {
    const created = await db.audioTrack.create({
      data: {
        accountId: accountId!,
        title: `Live-Durchsage ${new Date().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`,
        kind: "ANNOUNCEMENT",
        url: body.url.trim(),
        blobPathname:
          typeof body.blobPathname === "string" && body.blobPathname.trim()
            ? body.blobPathname.trim()
            : null,
        contentType:
          typeof body.contentType === "string" && body.contentType.trim()
            ? body.contentType.trim()
            : null,
        durationSec: Number.isFinite(Number(body.durationSec))
          ? Math.round(Number(body.durationSec))
          : null,
      },
      select: { id: true, url: true, durationSec: true },
    });
    track = created;
  } else {
    try {
      track = await renderTtsTrack(db, accountId!, text!, body.voice ?? null);
    } catch (error) {
      if (error instanceof TtsNotConfiguredError) {
        return NextResponse.json({ error: error.message }, { status: 501 });
      }
      const message = error instanceof Error ? error.message : "Sprachausgabe fehlgeschlagen";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const announcement = await db.audioAnnouncement.create({
    data: {
      accountId: accountId!,
      name: isRecording ? "Live-Durchsage" : text!.slice(0, 60),
      source: isRecording ? "LIVE" : "TTS",
      text,
      voice: typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : null,
      trackId: track.id,
      chime: body.chime ?? true,
      repeatCount: Math.min(5, Math.max(1, Math.round(Number(body.repeatCount) || 1))),
      priority: body.emergency ? 100 : 0,
      zoneIds: zones.map((z) => z.id),
      isTemplate: false,
    },
  });

  const queued = await queueAnnouncement(
    db,
    accountId!,
    { ...announcement, track },
    zones,
    body.emergency ? "EMERGENCY" : "MANUAL"
  );

  return NextResponse.json(
    { ok: true, queued, announcementId: announcement.id, url: track.url },
    { status: 201 }
  );
}
