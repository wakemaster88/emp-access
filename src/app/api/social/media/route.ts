import { NextRequest, NextResponse } from "next/server";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { encodeSocialImage, SOCIAL_UPLOAD_MAX_BYTES, socialMediaToken, storeSocialImage } from "@/lib/social/media";

export const maxDuration = 30;

/**
 * Bild für einen Social-Media-Beitrag hochladen (nur Admins). Der Body ist die
 * Bilddatei selbst. Gespeichert wird nur die neu kodierte Fassung (JPEG,
 * höchstens 1440 px, ohne Metadaten) im öffentlichen Blob-Speicher.
 */
export async function POST(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  if (!socialMediaToken()) return NextResponse.json({ error: "Bilder-Speicher ist nicht eingerichtet" }, { status: 501 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > SOCIAL_UPLOAD_MAX_BYTES) return NextResponse.json({ error: "Das Bild ist größer als 4 MB" }, { status: 413 });
  const input = new Uint8Array(await request.arrayBuffer());
  if (input.length === 0) return NextResponse.json({ error: "Keine Datei" }, { status: 400 });
  if (input.length > SOCIAL_UPLOAD_MAX_BYTES) return NextResponse.json({ error: "Das Bild ist größer als 4 MB" }, { status: 413 });
  const image = await encodeSocialImage(input);
  if (!image) return NextResponse.json({ error: "Die Datei lässt sich nicht als Bild lesen" }, { status: 400 });
  try {
    return NextResponse.json({ url: await storeSocialImage(auth.accountId, image) });
  } catch (e) {
    console.error("[social] Bild speichern fehlgeschlagen:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Das Bild ließ sich nicht speichern" }, { status: 502 });
  }
}
