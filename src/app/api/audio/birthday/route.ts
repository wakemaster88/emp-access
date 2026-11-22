import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { birthdayAnnounceSchema, normalizeBirthdayAnnounce } from "@/lib/gamification-input";
import {
  BIRTHDAY_BUILTIN_MUSIC_BYTES,
  BIRTHDAY_BUILTIN_MUSIC_PATH,
  BIRTHDAY_BUILTIN_MUSIC_SECONDS,
  BIRTHDAY_BUILTIN_MUSIC_TITLE,
} from "@/lib/birthday";

/**
 * PUT: Geburtstags-Durchsage einstellen. Scannt ein Geburtstagskind am
 * Start-Drehkreuz, kommt einmal am Tag die Ansage in den gewählten Zonen.
 */
export async function PUT(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (accountId == null) return NextResponse.json({ error: "Kein Mandant gewählt" }, { status: 403 });

  const parsed = birthdayAnnounceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const data: ReturnType<typeof normalizeBirthdayAnnounce> & { announceMusicTrackId?: number | null } =
    normalizeBirthdayAnnounce(parsed.data);
  if (data.announceZoneIds.length > 0) {
    const owned = await db.audioZone.count({ where: { accountId, id: { in: data.announceZoneIds } } });
    if (owned !== data.announceZoneIds.length) return NextResponse.json({ error: "Unbekannte Zone" }, { status: 400 });
  }

  // Musik unter der Ansage. Das mitgelieferte „Happy Birthday“ kommt beim
  // ersten Wählen als normaler Titel in die Mediathek (Datei unter /public).
  const music = parsed.data.announceMusic;
  if (music === null) data.announceMusicTrackId = null;
  else if (music === "builtin") {
    const url = `${request.nextUrl.origin}${BIRTHDAY_BUILTIN_MUSIC_PATH}`;
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
          url,
          contentType: "audio/mpeg",
          sizeBytes: BIRTHDAY_BUILTIN_MUSIC_BYTES,
          durationSec: BIRTHDAY_BUILTIN_MUSIC_SECONDS,
        },
        select: { id: true },
      }));
    data.announceMusicTrackId = track.id;
  } else if (typeof music === "number") {
    const owned = await db.audioTrack.count({ where: { accountId, id: music } });
    if (owned !== 1) return NextResponse.json({ error: "Unbekannter Titel" }, { status: 400 });
    data.announceMusicTrackId = music;
  }

  const saved = await db.riderBirthday.upsert({
    where: { accountId },
    create: { ...data, accountId },
    update: data,
  });
  return NextResponse.json(saved);
}
