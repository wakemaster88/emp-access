import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { previewWriteData } from "@/lib/camera-live-mode";
import { parseEmbeddingHeader, processCameraPersonEvent } from "@/lib/persons";
import { sentinelVouched } from "@/lib/hub-sentinel";
import { parseFaceQuality } from "@/lib/face-quality";

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

/**
 * POST (Hub, Token-Auth): Schnappschuss bei klarer Gesichtserkennung.
 * Query: cameraId, optional listedPersonId, matchScore, matchMethod,
 * optional sentinel=1 (der Wächter des Hubs bewertet diese Person; nur dann
 * darf die Cloud zu einer unbekannten Person schweigen, lib/hub-sentinel.ts),
 * optional faceSize, faceUpscaled, faceDetScore, faceMargin (Güte des
 * Gesichts, lib/face-quality.ts; fehlen sie wie bei einem älteren Hub, wird
 * die Sichtung wie bisher gespeichert)
 * Header: optional X-Face-Embedding (Base64, Float32 LE) fuer die Gruppierung
 * Body: raw JPEG (Content-Type image/jpeg)
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const q = request.nextUrl.searchParams;
  const cameraId = Number(q.get("cameraId"));
  if (!Number.isInteger(cameraId)) {
    return NextResponse.json({ error: "cameraId fehlt" }, { status: 400 });
  }

  const matchedPersonIdRaw = q.get("listedPersonId");
  const matchedPersonId = matchedPersonIdRaw ? Number(matchedPersonIdRaw) : null;
  const matchScoreRaw = q.get("matchScore");
  const matchScore = matchScoreRaw != null ? Number(matchScoreRaw) : null;
  const matchMethod = q.get("matchMethod");
  const sentinel = sentinelVouched(q.get("sentinel"));
  const faceQuality = parseFaceQuality(q);

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id },
    select: { id: true, liveMode: true },
  });
  if (!camera) return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 404 });

  if (matchedPersonId != null) {
    const person = await db.listedPerson.findFirst({
      where: { id: matchedPersonId, accountId: account.id },
      select: { id: true },
    });
    if (!person) {
      return NextResponse.json({ error: "Person nicht gefunden" }, { status: 404 });
    }
  }

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return NextResponse.json({ error: "Kein gültiges JPEG" }, { status: 400 });
  }
  if (buf.length > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ error: "Schnappschuss zu groß" }, { status: 413 });
  }

  const now = new Date();
  // select {id}: verhindert, dass RETURNING die JPEG-Bytes zurueckueberraegt.
  await db.camera.update({
    where: { id: cameraId },
    // Livebild und Vorschau „nur auf Tippen“ oder „aus“: kein Vorschaubild, nur „zuletzt gesehen“.
    data: previewWriteData(camera.liveMode, buf, now, true),
    select: { id: true },
  });

  const result = await processCameraPersonEvent({
    accountId: account.id,
    cameraId,
    seenAt: now,
    snapshot: buf,
    matchedPersonId: Number.isInteger(matchedPersonId) ? matchedPersonId : null,
    matchScore: Number.isFinite(matchScore) ? matchScore : null,
    matchMethod: matchMethod || null,
    faceEmbedding: parseEmbeddingHeader(request.headers.get("x-face-embedding")),
    sentinelVouched: sentinel,
    faceQuality,
  });

  return NextResponse.json({
    ok: true,
    bytes: buf.length,
    sightings: result.sightings,
    triggered: result.triggered,
    matchedPersonId: Number.isInteger(matchedPersonId) ? matchedPersonId : null,
  });
}
