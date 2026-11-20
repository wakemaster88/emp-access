import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { venueSession } from "@/lib/venue-session";

export const dynamic = "force-dynamic";

/** Alle Ressourcen mit Veranstaltungs-Einstellungen. */
export async function GET() {
  const s = await venueSession();
  if ("error" in s) return s.error;
  const areas = await prisma.accessArea.findMany({
    where: { accountId: s.accountId },
    select: { id: true, name: true, eventVenue: true, eventBufferMinutes: true, eventCapacity: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ areas });
}

const putSchema = z.object({
  areaId: z.coerce.number().int().positive(),
  eventVenue: z.boolean(),
  bufferMinutes: z.coerce.number().int().min(0).max(24 * 60),
  capacity: z.coerce.number().int().min(1).max(10_000).nullish(),
});

/** Ressource als Veranstaltungsraum ein-/ausschalten, Puffer und Kapazität. */
export async function PUT(request: NextRequest) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const d = parsed.data;
  const res = await prisma.accessArea.updateMany({
    where: { id: d.areaId, accountId: s.accountId },
    data: { eventVenue: d.eventVenue, eventBufferMinutes: d.bufferMinutes, eventCapacity: d.capacity ?? null },
  });
  if (res.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
