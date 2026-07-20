import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { listedPersonCreateSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const listType = request.nextUrl.searchParams.get("listType");
  const people = await db.listedPerson.findMany({
    where: {
      accountId: accountId!,
      ...(listType === "WHITELIST" || listType === "BLACKLIST" ? { listType } : {}),
    },
    include: {
      camera: { select: { id: true, name: true } },
      shellyDevice: { select: { id: true, name: true } },
      _count: { select: { sightings: true } },
    },
    orderBy: [{ isActive: "desc" }, { listType: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(people);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  const parsed = listedPersonCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.cameraId) {
    const camera = await db.camera.findFirst({
      where: { id: parsed.data.cameraId, accountId: accountId! },
      select: { id: true },
    });
    if (!camera) return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 400 });
  }
  if (parsed.data.shellyDeviceId) {
    const device = await db.device.findFirst({
      where: { id: parsed.data.shellyDeviceId, accountId: accountId!, type: "SHELLY" },
      select: { id: true },
    });
    if (!device) return NextResponse.json({ error: "Shelly nicht gefunden" }, { status: 400 });
  }

  const person = await db.listedPerson.create({
    data: {
      accountId: accountId!,
      name: parsed.data.name.trim(),
      listType: parsed.data.listType,
      isActive: parsed.data.isActive ?? true,
      notes: parsed.data.notes?.trim() || null,
      cameraId: parsed.data.cameraId ?? null,
      trackHistory: parsed.data.trackHistory ?? true,
      triggerOnDetection: parsed.data.triggerOnDetection ?? false,
      notifyOnDetection: parsed.data.notifyOnDetection ?? false,
      shellyDeviceId: parsed.data.shellyDeviceId ?? null,
      shellyAction: parsed.data.shellyAction ?? "ON",
      timerSeconds: parsed.data.timerSeconds ?? null,
      cooldownMinutes: parsed.data.cooldownMinutes ?? 5,
    },
    include: {
      camera: { select: { id: true, name: true } },
      shellyDevice: { select: { id: true, name: true } },
      _count: { select: { sightings: true } },
    },
  });
  return NextResponse.json(person, { status: 201 });
}
