import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { processCameraPersonEvent } from "@/lib/persons";

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

/**
 * POST (Hub, Token-Auth): Schnappschuss bei klarer Gesichtserkennung.
 * Query: cameraId, optional listedPersonId, matchScore, matchMethod
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

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id },
    select: { id: true },
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
    data: { snapshot: buf, snapshotAt: now, lastSeenAt: now },
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
  });

  return NextResponse.json({
    ok: true,
    bytes: buf.length,
    sightings: result.sightings,
    triggered: result.triggered,
    matchedPersonId: Number.isInteger(matchedPersonId) ? matchedPersonId : null,
  });
}
