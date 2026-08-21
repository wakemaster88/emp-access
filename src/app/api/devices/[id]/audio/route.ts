import { NextRequest, NextResponse } from "next/server";
import { getAccountFromRequest } from "@/lib/api-auth";
import {
  controlAudioDevice,
  parseAudioControlBody,
} from "@/lib/audio-integration";

/**
 * Audio-Steuerung eines Abspielers: Start (Playlist/Titel/Stream), Stopp,
 * Lautstärke. Auth wie die übrigen Geräte-Endpunkte (Session oder API-Token).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAccountFromRequest(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = parseAudioControlBody(body);
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const device = await auth.db.device.findFirst({
    where: { id: deviceId, accountId: auth.accountId },
    select: { id: true, type: true, category: true, isActive: true },
  });
  if (!device || !device.isActive) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const result = await controlAudioDevice(auth.db, auth.accountId, device, input);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, volume: result.volume });
}
