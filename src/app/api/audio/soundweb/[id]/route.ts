import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import type { TenantDb } from "@/lib/prisma";
import {
  parseDeviceInput,
  queueSoundwebSync,
  serializeSoundwebDevice,
  soundwebDeviceInclude,
} from "@/lib/soundweb-server";

async function loadDevice(id: string, accountId: number, db: TenantDb) {
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId)) return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  const device = await db.soundwebDevice.findFirst({ where: { id: deviceId, accountId } });
  if (!device) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  return { device };
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const found = await loadDevice(id, accountId!, db);
  if ("error" in found) return found.error;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });

  const input = parseDeviceInput(body, found.device);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const changedLink =
    input.host !== found.device.host ||
    input.port !== found.device.port ||
    input.node !== found.device.node ||
    input.isActive !== found.device.isActive;

  const device = await db.soundwebDevice.update({
    where: { id: found.device.id },
    data: {
      ...input,
      // Neue Adresse: alter Zustand sagt nichts mehr aus.
      ...(changedLink ? { connected: false, lastError: null } : {}),
    },
    include: soundwebDeviceInclude,
  });
  await queueSoundwebSync(db, accountId!);
  return NextResponse.json(serializeSoundwebDevice(device));
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const found = await loadDevice(id, accountId!, db);
  if ("error" in found) return found.error;

  await db.soundwebDevice.delete({ where: { id: found.device.id } });
  await queueSoundwebSync(db, accountId!);
  return NextResponse.json({ ok: true });
}
