import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { newDeviceApiToken } from "@/lib/tokens";

const TOKEN_DEVICE_TYPES = new Set(["RASPBERRY_PI", "AUDIO_PLAYER"]);

async function loadDevice(request: NextRequest, params: Promise<{ id: string }>) {
  const session = await getSessionWithDb();
  if ("error" in session) return { error: session.error };
  const deviceId = Number((await params).id);
  if (!Number.isInteger(deviceId)) {
    return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  }
  const device = await session.db.device.findFirst({
    where: { id: deviceId, accountId: session.accountId! },
    select: { id: true, type: true },
  });
  if (!device) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  if (!TOKEN_DEVICE_TYPES.has(device.type)) {
    return { error: NextResponse.json({ error: "Nur Scanner- und Audio-Pis haben ein eigenes Token" }, { status: 400 }) };
  }
  return { db: session.db, device };
}

/**
 * POST: neues Geraete-Token erzeugen (ersetzt ein bestehendes). Das Token
 * wird genau einmal im Klartext zurueckgegeben; danach steht in der
 * Datenbank nur noch der Wert, den das Geraet kennt.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadDevice(request, params);
  if ("error" in loaded) return loaded.error;
  const apiToken = newDeviceApiToken();
  await loaded.db.device.update({
    where: { id: loaded.device.id },
    data: { apiToken },
    select: { id: true },
  });
  return NextResponse.json({ apiToken });
}

/** DELETE: Geraete-Token zurueckziehen; das Geraet faellt auf das Account-Token zurueck. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadDevice(request, params);
  if ("error" in loaded) return loaded.error;
  await loaded.db.device.update({
    where: { id: loaded.device.id },
    data: { apiToken: null },
    select: { id: true },
  });
  return NextResponse.json({ ok: true });
}
