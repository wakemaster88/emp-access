import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import {
  DETECTION_SELECT,
  detectionUpdateData,
  mergeDetectionSettings,
} from "@/lib/camera-detection";

/**
 * PATCH (Hub, Token-Auth): Fahrzeug-Erkennung und Halteverbot einer Kamera
 * aus dem lokalen Hub-Dashboard aendern. Nur diese Felder, keine Zugangsdaten.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const { id } = await params;
  const cameraId = Number(id);
  if (!Number.isInteger(cameraId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id },
    select: { id: true, ...DETECTION_SELECT },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const merged = mergeDetectionSettings(existing, body);
  if ("error" in merged) return NextResponse.json({ error: merged.error }, { status: 400 });

  const camera = await db.camera.update({
    where: { id: cameraId },
    data: detectionUpdateData(merged.settings),
    select: { id: true, name: true, ...DETECTION_SELECT },
  });
  return NextResponse.json(camera);
}
