import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";
import { renderTtsTrack, TtsNotConfiguredError } from "@/lib/audio";
import {
  BIRTHDAY_BED_LEVEL,
  BIRTHDAY_BED_SPEECH_DELAY,
  BIRTHDAY_BUILTIN_MUSIC_PATH,
  BIRTHDAY_BUILTIN_MUSIC_SECONDS,
  birthdayAnnounceText,
  birthdayBedUntil,
  ttsSeconds,
} from "@/lib/birthday";

const schema = z.object({
  announceText: z.string().trim().max(300).nullable(),
  announceName: z.boolean(),
  announceVoice: z.string().trim().max(60).nullable(),
  announceMusic: z.union([z.literal("builtin"), z.number().int().positive(), z.null()]).optional(),
});

/**
 * POST: Probe der Geburtstags-Durchsage nur zum Anhören im Browser. Spielt
 * nichts in einer Zone ab; der Beispielname ist „Mia“. Mit Musik liefert
 * die Antwort zusätzlich Titel und Zeiten, der Browser mischt beides grob nach.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (accountId == null) return NextResponse.json({ error: "Kein Mandant gewählt" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const text = birthdayAnnounceText(parsed.data, "Mia");
  try {
    const track = await renderTtsTrack(db, accountId, text, parsed.data.announceVoice || null);
    const music = parsed.data.announceMusic;
    let bed: { url: string; untilSec: number; delaySec: number; level: number } | null = null;
    if (music != null) {
      const speech = await db.audioTrack.findFirst({ where: { id: track.id, accountId }, select: { durationSec: true, sizeBytes: true } });
      const m =
        music === "builtin"
          ? { url: BIRTHDAY_BUILTIN_MUSIC_PATH, durationSec: BIRTHDAY_BUILTIN_MUSIC_SECONDS }
          : await db.audioTrack.findFirst({ where: { id: music, accountId }, select: { url: true, durationSec: true } });
      if (m) {
        bed = {
          url: m.url,
          untilSec: birthdayBedUntil(speech ? ttsSeconds(speech) : null, m.durationSec),
          delaySec: BIRTHDAY_BED_SPEECH_DELAY,
          level: BIRTHDAY_BED_LEVEL,
        };
      }
    }
    return NextResponse.json({ url: track.url, text, bed });
  } catch (error) {
    if (error instanceof TtsNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 501 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sprachausgabe fehlgeschlagen" }, { status: 502 });
  }
}
