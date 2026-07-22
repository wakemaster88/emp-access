import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const cameraId = Number(id);
  if (isNaN(cameraId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.camera.findFirst({ where: { id: cameraId, accountId: accountId! } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  if (!name) return NextResponse.json({ error: "Name darf nicht leer sein" }, { status: 400 });
  if (name !== existing.name) {
    const dup = await db.camera.findFirst({ where: { accountId: accountId!, name, NOT: { id: cameraId } } });
    if (dup) return NextResponse.json({ error: "Eine Kamera mit diesem Namen existiert bereits" }, { status: 400 });
  }

  const camera = await db.camera.update({
    where: { id: cameraId },
    data: {
      name,
      kind:
        body.kind === "DOORBIRD" || body.kind === "REOLINK" ? body.kind : existing.kind,
      host: body.host !== undefined ? String(body.host).trim() : existing.host,
      httpPort: body.httpPort !== undefined ? (Number(body.httpPort) || 80) : existing.httpPort,
      https: typeof body.https === "boolean" ? body.https : existing.https,
      username: body.username !== undefined ? String(body.username).trim() : existing.username,
      // Leeres Passwort im Formular bedeutet "unveraendert lassen".
      password: body.password ? String(body.password) : existing.password,
      channel: body.channel !== undefined ? (Number(body.channel) || 0) : existing.channel,
      enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled,
      vehicleDetection:
        typeof body.vehicleDetection === "boolean"
          ? body.vehicleDetection
          : existing.vehicleDetection,
      notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
    },
    select: { id: true, name: true, host: true, enabled: true },
  });
  return NextResponse.json(camera);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const cameraId = Number(id);
  if (isNaN(cameraId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.camera.findFirst({ where: { id: cameraId, accountId: accountId! } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.camera.delete({ where: { id: cameraId } });
  return NextResponse.json({ ok: true });
}
