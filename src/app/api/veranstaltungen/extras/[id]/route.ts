import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseId, venueSession } from "@/lib/venue-session";
import { extraSchema } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Ändert Name, Preis, Einheit, Sichtbarkeit. Schon gebuchte Termine behalten ihren Preis. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const parsed = extraSchema.omit({ areaId: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  const res = await prisma.venueExtra.updateMany({ where: { id, accountId: s.accountId }, data: parsed.data });
  if (res.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Löschen. Gebuchte Termine behalten Name und Preis als Schnappschuss. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const res = await prisma.venueExtra.deleteMany({ where: { id, accountId: s.accountId } });
  if (res.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
