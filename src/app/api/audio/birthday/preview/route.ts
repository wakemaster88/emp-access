import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";
import { renderTtsTrack, TtsNotConfiguredError } from "@/lib/audio";
import { birthdayAnnounceText } from "@/lib/birthday";

const schema = z.object({
  announceText: z.string().trim().max(300).nullable(),
  announceName: z.boolean(),
  announceVoice: z.string().trim().max(60).nullable(),
});

/**
 * POST: Probe der Geburtstags-Durchsage nur zum Anhören im Browser. Spielt
 * nichts in einer Zone ab; der Beispielname ist „Mia“.
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
    return NextResponse.json({ url: track.url, text });
  } catch (error) {
    if (error instanceof TtsNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 501 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sprachausgabe fehlgeschlagen" }, { status: 502 });
  }
}
