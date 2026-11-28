/**
 * Geräte-Schnittstelle der Zonen-Abspieler (Raspberry Pi, `emp_audio`).
 *
 * GET  – Zonenkonfiguration + offene Jobs abholen (werden auf SENT gesetzt).
 * POST – Heartbeat mit Ist-Zustand und Statusmeldungen zu erledigten Jobs.
 *
 * Auth läuft wie bei den Scanner-Pis über das Account-API-Token. Antwort und
 * Heartbeat teilt sich der Pi mit dem Monitor im Browser
 * (`src/lib/audio-player-state.ts`).
 */
import { NextRequest, NextResponse } from "next/server";
import { deviceTokenMismatch, validateApiToken } from "@/lib/api-token-auth";
import { playerStateBody, playerZoneInclude, recordPlayerReport } from "@/lib/audio-player-state";
import { ifNoneMatchMatches, jsonEtag } from "@/lib/http-etag";

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request, { allowDevice: true });
  if ("error" in auth) return auth.error;

  const deviceId = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(deviceId)) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }
  const mismatch = deviceTokenMismatch(auth, deviceId);
  if (mismatch) return mismatch;

  const { db } = auth;
  const zone = await db.audioZone.findFirst({
    where: { deviceId, device: { type: "AUDIO_PLAYER" } },
    include: playerZoneInclude,
  });

  if (!zone) {
    return NextResponse.json({ error: "Zone not found" }, { status: 404 });
  }

  const body = await playerStateBody(db, zone);

  // ETag ueber die ganze Antwort. 304 nur ohne offene Jobs: Jobs gehen immer
  // mit vollem Body raus. Abspieler ohne If-None-Match bekommen wie bisher 200.
  const etag = jsonEtag(body);
  if (body.jobs.length === 0 && ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  return NextResponse.json(body, { headers: { ETag: etag } });
}

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request, { allowDevice: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const deviceId = Number(body.deviceId);
  if (!Number.isInteger(deviceId)) {
    return NextResponse.json({ error: "deviceId erforderlich" }, { status: 400 });
  }
  const mismatch = deviceTokenMismatch(auth, deviceId);
  if (mismatch) return mismatch;

  const { db } = auth;
  const zone = await db.audioZone.findFirst({
    where: { deviceId, device: { type: "AUDIO_PLAYER" } },
    select: { id: true, accountId: true, volume: true },
  });
  if (!zone) return NextResponse.json({ error: "Zone not found" }, { status: 404 });

  const now = new Date();

  await db.device.updateMany({
    where: { id: deviceId, type: "AUDIO_PLAYER" },
    data: {
      lastUpdate: now,
      ...(body.systemInfo && typeof body.systemInfo === "object"
        ? { systemInfo: body.systemInfo }
        : {}),
    },
  });

  const pending = await recordPlayerReport(db, zone, body, now);
  return NextResponse.json({ ok: true, pendingJobs: pending });
}
