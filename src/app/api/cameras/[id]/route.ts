import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

  // Ohne select wuerde auch der Snapshot (Bytes) mitgeladen.
  const existing = await db.camera.findFirst({
    where: { id: cameraId, accountId: accountId! },
    select: {
      id: true,
      name: true,
      kind: true,
      host: true,
      httpPort: true,
      https: true,
      username: true,
      password: true,
      channel: true,
      enabled: true,
      vehicleDetection: true,
      vehicleMinArea: true,
      vehicleZone: true,
      notes: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();

  // Mindestgroesse als Anteil 0..0.5 (null = Hub-Standard); Zone als
  // Polygon mit mindestens drei normierten Punkten (null = keine Zone).
  let vehicleMinArea = existing.vehicleMinArea;
  if (body.vehicleMinArea !== undefined) {
    if (body.vehicleMinArea === null || body.vehicleMinArea === "") vehicleMinArea = null;
    else {
      const n = Number(body.vehicleMinArea);
      if (!Number.isFinite(n) || n < 0 || n > 0.5) {
        return NextResponse.json({ error: "Mindestgröße muss zwischen 0 und 50 % liegen" }, { status: 400 });
      }
      vehicleMinArea = n;
    }
  }
  let vehicleZone = existing.vehicleZone;
  if (body.vehicleZone !== undefined) {
    if (body.vehicleZone === null || (Array.isArray(body.vehicleZone) && body.vehicleZone.length === 0)) {
      vehicleZone = null as typeof existing.vehicleZone;
    } else {
      const pts = Array.isArray(body.vehicleZone) ? body.vehicleZone : null;
      const ok =
        pts &&
        pts.length >= 3 &&
        pts.length <= 32 &&
        pts.every(
          (p: unknown) =>
            Array.isArray(p) &&
            p.length === 2 &&
            p.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)
        );
      if (!ok) {
        return NextResponse.json({ error: "Zone braucht 3 bis 32 Punkte mit Werten zwischen 0 und 1" }, { status: 400 });
      }
      vehicleZone = pts.map((p: number[]) => [Math.round(p[0] * 10000) / 10000, Math.round(p[1] * 10000) / 10000]);
    }
  }
  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  if (!name) return NextResponse.json({ error: "Name darf nicht leer sein" }, { status: 400 });
  if (name !== existing.name) {
    const dup = await db.camera.findFirst({
      where: { accountId: accountId!, name, NOT: { id: cameraId } },
      select: { id: true },
    });
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
      vehicleMinArea,
      // Prisma: JSON-Spalte auf NULL setzen geht nur ueber DbNull.
      vehicleZone: vehicleZone === null ? Prisma.DbNull : vehicleZone ?? undefined,
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

  const existing = await db.camera.findFirst({
    where: { id: cameraId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.camera.delete({ where: { id: cameraId }, select: { id: true } });
  return NextResponse.json({ ok: true });
}
