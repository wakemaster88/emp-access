import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { venueSession } from "@/lib/venue-session";
import { eventInclude, saveEvent, serializeEventForAdmin } from "@/lib/venue-events";
import { eventInputSchema } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&areaId= – Termine (Standard: ab 30 Tagen zurück). */
export async function GET(request: NextRequest) {
  const s = await venueSession();
  if ("error" in s) return s.error;
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = sp.get("to");
  const areaId = Number(sp.get("areaId")) || undefined;
  const rows = await prisma.venueEvent.findMany({
    where: { accountId: s.accountId, date: { gte: from, ...(to ? { lte: to } : {}) }, ...(areaId ? { areaId } : {}) },
    include: eventInclude,
    orderBy: { startDate: "asc" },
    take: 1000,
  });
  return NextResponse.json({ events: rows.map(serializeEventForAdmin) });
}

const postSchema = eventInputSchema.extend({
  partnerId: z.coerce.number().int().positive().nullish(),
  internalNote: z.string().trim().max(2000).nullish().transform((v) => v || null),
});

/** Termin im Backoffice anlegen (eigener Termin oder für einen Partner). */
export async function POST(request: NextRequest) {
  const s = await venueSession();
  if ("error" in s) return s.error;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  const { partnerId, internalNote, ...input } = parsed.data;
  if (partnerId) {
    const partner = await prisma.eventPartner.findFirst({ where: { id: partnerId, accountId: s.accountId }, select: { id: true } });
    if (!partner) return NextResponse.json({ error: "Partner nicht gefunden" }, { status: 400 });
  }
  const result = await saveEvent({ accountId: s.accountId, actor: s.actor, input, partnerId: partnerId ?? null, internalNote });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ event: serializeEventForAdmin(result.event) }, { status: 201 });
}
