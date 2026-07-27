/**
 * Erzeugt Upload-Tokens für Client-Uploads in den Blob-Storage. Die Datei geht
 * direkt vom Browser zum Storage und nicht durch die Function – nur so lassen
 * sich Musikdateien jenseits des Request-Limits von 4,5 MB hochladen.
 *
 * Registriert wird der Track anschließend vom Client über POST /api/audio/tracks.
 */
import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getSessionWithDb } from "@/lib/api-auth";

const ALLOWED_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
  "audio/mp4",
  "audio/aac",
];

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Blob-Storage ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN fehlt)" },
      { status: 501 }
    );
  }

  const accountId = session.accountId;
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        addRandomSuffix: true,
        maximumSizeInBytes: 50 * 1024 * 1024,
        // Mandanten-Präfix, damit Dateien im Storage zuordenbar bleiben.
        pathname: `audio/${accountId ?? "shared"}`,
      }),
      // Der Track-Datensatz wird vom Client registriert; dieser Callback ist
      // nur für Logging da und wird lokal ohnehin nicht aufgerufen.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload fehlgeschlagen";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
