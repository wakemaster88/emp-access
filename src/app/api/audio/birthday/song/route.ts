import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { birthdaySongSchema } from "@/lib/gamification-input";
import {
  BIRTHDAY_BUILTIN_MUSIC_BYTES,
  BIRTHDAY_BUILTIN_MUSIC_PATH,
  BIRTHDAY_BUILTIN_MUSIC_SECONDS,
  BIRTHDAY_BUILTIN_MUSIC_TITLE,
} from "@/lib/birthday";

/**
 * PUT: Geburtstagssong einstellen. Wird ein Geburtstagskind am Shop-Monitor
 * gescannt, läuft der Song einmal in den gewählten Zonen (lib/rider-birthday).
 */
export async function PUT(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (accountId == null) return NextResponse.json({ error: "Kein Mandant gewählt" }, { status: 403 });

  const parsed = birthdaySongSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const zoneIds = [...new Set(parsed.data.monitorSongZoneIds)];
  if (zoneIds.length > 0) {
    const owned = await db.audioZone.count({ where: { accountId, id: { in: zoneIds } } });
    if (owned !== zoneIds.length) return NextResponse.json({ error: "Unbekannte Zone" }, { status: 400 });
  }

  // Der Song. Das mitgelieferte „Happy Birthday“ kommt beim ersten Wählen als
  // normaler Titel in die Mediathek (Datei unter /public), wie bei der Ansage.
  let trackId: number | null = null;
  const song = parsed.data.monitorSong;
  if (song === "builtin") {
    const existing = await db.audioTrack.findFirst({
      where: { accountId, url: { endsWith: BIRTHDAY_BUILTIN_MUSIC_PATH } },
      select: { id: true },
    });
    const track =
      existing ??
      (await db.audioTrack.create({
        data: {
          accountId,
          title: BIRTHDAY_BUILTIN_MUSIC_TITLE,
          kind: "MUSIC",
          url: `${request.nextUrl.origin}${BIRTHDAY_BUILTIN_MUSIC_PATH}`,
          contentType: "audio/mpeg",
          sizeBytes: BIRTHDAY_BUILTIN_MUSIC_BYTES,
          durationSec: BIRTHDAY_BUILTIN_MUSIC_SECONDS,
        },
        select: { id: true },
      }));
    trackId = track.id;
  } else if (typeof song === "number") {
    const owned = await db.audioTrack.count({ where: { accountId, id: song } });
    if (owned !== 1) return NextResponse.json({ error: "Unbekannter Titel" }, { status: 400 });
    trackId = song;
  }

  const data = {
    monitorSongActive: parsed.data.monitorSongActive,
    monitorSongZoneIds: zoneIds,
    monitorSongTrackId: trackId,
  };
  const saved = await db.riderBirthday.upsert({
    where: { accountId },
    create: { ...data, accountId },
    update: data,
    select: { monitorSongActive: true, monitorSongZoneIds: true, monitorSongTrackId: true },
  });
  return NextResponse.json(saved);
}
