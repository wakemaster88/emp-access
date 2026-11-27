import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { publicBlobToken } from "@/lib/blob-token";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { encodeNewsletterImage, NEWSLETTER_IMAGE_MAX_BYTES } from "@/lib/newsletter/image";

export const maxDuration = 30;

/**
 * Bild für eine Aussendung hochladen (nur Admins). Der Body ist die Bilddatei
 * selbst. Gespeichert wird nur die neu kodierte Fassung, im öffentlichen
 * Blob-Speicher: Mailprogramme laden Bilder ohne Anmeldung.
 */
export async function POST(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const blobToken = publicBlobToken();
  if (!blobToken) {
    return NextResponse.json({ error: "Bilder-Speicher ist nicht eingerichtet" }, { status: 501 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > NEWSLETTER_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "Das Bild ist größer als 4 MB" }, { status: 413 });
  }
  const input = new Uint8Array(await request.arrayBuffer());
  if (input.length > NEWSLETTER_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "Das Bild ist größer als 4 MB" }, { status: 413 });
  }
  const image = await encodeNewsletterImage(input);
  if (!image) {
    return NextResponse.json({ error: "Die Datei lässt sich nicht als Bild lesen" }, { status: 400 });
  }

  // Token ausdrücklich: Mit angebundenem privatem Speicher (OIDC) nähme
  // @vercel/blob sonst diesen und lehnte öffentliche Dateien ab.
  const path = `newsletter/${auth.accountId}/${Date.now()}-${randomBytes(9).toString("base64url")}.${image.ext}`;
  try {
    const blob = await put(path, Buffer.from(image.bytes), {
      access: "public",
      token: blobToken,
      contentType: image.contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return NextResponse.json({ url: blob.url, width: image.width, height: image.height });
  } catch (e) {
    console.error("[newsletter] Bild speichern fehlgeschlagen:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Das Bild ließ sich nicht speichern" }, { status: 502 });
  }
}
