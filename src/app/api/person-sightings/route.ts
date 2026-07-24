import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { personSightingCreateSchema } from "@/lib/validators";
import { processManualPersonSighting } from "@/lib/persons";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const listType = request.nextUrl.searchParams.get("listType");
  const personId = request.nextUrl.searchParams.get("personId");
  const take = Math.min(Number(request.nextUrl.searchParams.get("take") ?? 100) || 100, 500);

  // Explizites select ohne `snapshot`: die Bytes (~0,5 MB pro Sichtung)
  // gehoeren nicht in die JSON-Liste – Bilder laufen ueber /[id]/snapshot.
  const sightings = await db.personSighting.findMany({
    where: {
      accountId: accountId!,
      ...(listType === "WHITELIST" || listType === "BLACKLIST" ? { listType } : {}),
      ...(personId ? { listedPersonId: Number(personId) } : {}),
    },
    select: {
      id: true,
      accountId: true,
      listedPersonId: true,
      source: true,
      listType: true,
      matched: true,
      matchScore: true,
      matchMethod: true,
      shellyTriggered: true,
      shellyOk: true,
      notes: true,
      seenAt: true,
      createdAt: true,
      cameraId: true,
      camera: { select: { id: true, name: true } },
      listedPerson: { select: { id: true, name: true, listType: true } },
    },
    orderBy: { seenAt: "desc" },
    take,
  });
  return NextResponse.json(sightings);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  const parsed = personSightingCreateSchema.safeParse(body);
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

  try {
    const result = await processManualPersonSighting({
      accountId: accountId!,
      listedPersonId: parsed.data.listedPersonId,
      cameraId: parsed.data.cameraId,
      notes: parsed.data.notes,
      triggerShelly: parsed.data.triggerShelly,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fehler" },
      { status: 400 }
    );
  }
}
